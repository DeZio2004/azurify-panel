package service

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"

	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/logger"
)

// Shared ports: several TCP inbounds on one port. Xray cannot bind a port twice, so
// one VLESS/Trojan inbound on raw TCP with TLS or REALITY (the master) keeps the
// real listener and the others are moved to a hidden loopback port in the generated
// config, reached through fallbacks on the master. The database rows are untouched,
// so links and subscriptions keep showing the shared public port.

const sharedPortChildBase = 41000

type sharedPortChild struct {
	inbound *model.Inbound
	name    string
	path    string
}

type sharedPortPlan struct {
	master   *model.Inbound
	children []sharedPortChild
}

func sharedPortOrder(ib *model.Inbound) int {
	if ib.Id == 0 {
		return math.MaxInt
	}
	return ib.Id
}

func sortBySharedPortOrder(members []*model.Inbound) []*model.Inbound {
	sorted := slices.Clone(members)
	slices.SortStableFunc(sorted, func(a, b *model.Inbound) int {
		return cmp.Compare(sharedPortOrder(a), sharedPortOrder(b))
	})
	return sorted
}

func inboundXrayManaged(ib *model.Inbound) bool {
	switch ib.Protocol {
	case model.MTProto, model.AmneziaWG, model.TUIC:
		return false
	}
	return true
}

// inboundCanBeSharedChild: only a TCP-only inbound can move to loopback, or its
// UDP half would leave the public port.
func inboundCanBeSharedChild(ib *model.Inbound) bool {
	return inboundXrayManaged(ib) &&
		inboundTransports(ib.Protocol, ib.StreamSettings, ib.Settings) == transportTCP
}

func streamServerName(streamSettings string) string {
	var stream struct {
		TLSSettings struct {
			ServerName string `json:"serverName"`
		} `json:"tlsSettings"`
	}
	_ = json.Unmarshal([]byte(streamSettings), &stream)
	return stream.TLSSettings.ServerName
}

// sharedChildMatch is how the master tells a child's traffic apart: the WebSocket or
// HTTPUpgrade path, else a TLS server name that differs from the master's. Neither
// means the child is the catch-all.
func sharedChildMatch(streamSettings, masterSNI string) (name, path string) {
	var stream struct {
		Network   string `json:"network"`
		WSSetting struct {
			Path string `json:"path"`
		} `json:"wsSettings"`
		HTTPUpgrade struct {
			Path string `json:"path"`
		} `json:"httpupgradeSettings"`
		TLSSettings struct {
			ServerName string `json:"serverName"`
		} `json:"tlsSettings"`
	}
	_ = json.Unmarshal([]byte(streamSettings), &stream)
	switch stream.Network {
	case "ws":
		path = stream.WSSetting.Path
	case "httpupgrade":
		path = stream.HTTPUpgrade.Path
	}
	if path != "" {
		return "", path
	}
	if sni := stream.TLSSettings.ServerName; sni != "" && sni != masterSNI {
		name = sni
	}
	return name, ""
}

// planSharedPort decides whether members can all live on one port.
func planSharedPort(members []*model.Inbound) (*sharedPortPlan, error) {
	sorted := sortBySharedPortOrder(members)
	var master *model.Inbound
	for _, m := range sorted {
		if inboundCanHostFallbacks(m) {
			master = m
			break
		}
	}
	if master == nil {
		return nil, errors.New("sharing a port needs one VLESS or Trojan inbound on raw TCP with TLS or REALITY to hold it")
	}
	plan := &sharedPortPlan{master: master}
	masterSNI := streamServerName(master.StreamSettings)
	seen := map[string]bool{}
	for _, m := range sorted {
		if m == master {
			continue
		}
		if !inboundCanBeSharedChild(m) {
			return nil, fmt.Errorf("inbound %q cannot share a port: only TCP-only inbounds can sit behind the master", m.Remark)
		}
		name, path := sharedChildMatch(m.StreamSettings, masterSNI)
		key := name + "|" + path
		if seen[key] {
			return nil, errors.New("two inbounds on this port cannot be told apart: give each its own WebSocket path or TLS server name, and leave at most one without")
		}
		seen[key] = true
		plan.children = append(plan.children, sharedPortChild{inbound: m, name: name, path: path})
	}
	return plan, nil
}

func stripStreamSecurity(streamSettings string) string {
	var stream map[string]any
	if json.Unmarshal([]byte(streamSettings), &stream) != nil {
		return streamSettings
	}
	stream["security"] = "none"
	delete(stream, "tlsSettings")
	delete(stream, "realitySettings")
	out, err := json.Marshal(stream)
	if err != nil {
		return streamSettings
	}
	return string(out)
}

// applySharedPorts rewrites, in memory only, every group of enabled local TCP inbounds
// that share a port, and returns the fallback entries each master must carry.
func applySharedPorts(inbounds []*model.Inbound) map[int][]map[string]any {
	used := map[int]bool{}
	byPort := map[int][]*model.Inbound{}
	for _, ib := range inbounds {
		used[ib.Port] = true
		if !ib.Enable || ib.NodeID != nil || !inboundXrayManaged(ib) {
			continue
		}
		if inboundTransports(ib.Protocol, ib.StreamSettings, ib.Settings)&transportTCP == 0 {
			continue
		}
		byPort[ib.Port] = append(byPort[ib.Port], ib)
	}
	ports := make([]int, 0, len(byPort))
	for port := range byPort {
		ports = append(ports, port)
	}
	slices.Sort(ports)

	extras := map[int][]map[string]any{}
	for _, port := range ports {
		if len(byPort[port]) < 2 {
			continue
		}
		var clusters [][]*model.Inbound
		for _, ib := range sortBySharedPortOrder(byPort[port]) {
			placed := false
			for i, cluster := range clusters {
				if listenOverlaps(inboundBindAddr(cluster[0]), inboundBindAddr(ib)) {
					clusters[i] = append(cluster, ib)
					placed = true
					break
				}
			}
			if !placed {
				clusters = append(clusters, []*model.Inbound{ib})
			}
		}
		for _, cluster := range clusters {
			if len(cluster) < 2 {
				continue
			}
			plan, err := planSharedPort(cluster)
			if err != nil {
				// Keep Xray alive: leave the lowest-id inbound and drop the rest.
				logger.Warningf("port %d: %v; disabling %d conflicting inbound(s)", port, err, len(cluster)-1)
				for _, ib := range cluster[1:] {
					ib.Enable = false
				}
				continue
			}
			for _, child := range plan.children {
				childPort := sharedPortChildBase + child.inbound.Id
				for used[childPort] {
					childPort++
				}
				used[childPort] = true
				child.inbound.Listen = "127.0.0.1"
				child.inbound.Port = childPort
				child.inbound.StreamSettings = stripStreamSecurity(child.inbound.StreamSettings)
				entry := map[string]any{
					"dest": fmt.Sprintf("127.0.0.1:%d", childPort),
					"xver": 0,
				}
				if child.name != "" {
					entry["name"] = child.name
				}
				if child.path != "" {
					entry["path"] = child.path
				}
				extras[plan.master.Id] = append(extras[plan.master.Id], entry)
			}
		}
	}
	return extras
}
