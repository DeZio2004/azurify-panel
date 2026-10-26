package service

import (
	"strings"
	"testing"

	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
)

const sharedTLSStream = `{"network":"tcp","security":"tls","tlsSettings":{"serverName":"a.example.com"}}`

func TestApplySharedPortsMovesChildBehindMaster(t *testing.T) {
	master := &model.Inbound{Id: 1, Enable: true, Port: 443, Protocol: model.VLESS, StreamSettings: sharedTLSStream}
	child := &model.Inbound{Id: 2, Enable: true, Port: 443, Protocol: model.Trojan, StreamSettings: sharedTLSStream}

	extras := applySharedPorts([]*model.Inbound{master, child})

	if master.Port != 443 {
		t.Fatalf("master port moved to %d", master.Port)
	}
	if child.Port == 443 || child.Listen != "127.0.0.1" {
		t.Fatalf("child not moved to loopback: %s:%d", child.Listen, child.Port)
	}
	if strings.Contains(child.StreamSettings, "tlsSettings") {
		t.Fatalf("child kept its TLS settings: %s", child.StreamSettings)
	}
	if len(extras[master.Id]) != 1 {
		t.Fatalf("want one fallback on master, got %d", len(extras[master.Id]))
	}
}

func TestApplySharedPortsDisablesUnshareableGroup(t *testing.T) {
	a := &model.Inbound{Id: 1, Enable: true, Port: 8080, Protocol: model.VMESS, StreamSettings: `{"network":"tcp","security":"none"}`}
	b := &model.Inbound{Id: 2, Enable: true, Port: 8080, Protocol: model.Trojan, StreamSettings: `{"network":"tcp","security":"none"}`}

	applySharedPorts([]*model.Inbound{a, b})

	if !a.Enable || b.Enable {
		t.Fatalf("want only the first inbound kept, got a=%v b=%v", a.Enable, b.Enable)
	}
}

func TestPlanSharedPortRejectsIndistinguishableChildren(t *testing.T) {
	master := &model.Inbound{Id: 1, Port: 443, Protocol: model.VLESS, StreamSettings: sharedTLSStream}
	c1 := &model.Inbound{Id: 2, Port: 443, Protocol: model.Trojan, StreamSettings: sharedTLSStream}
	c2 := &model.Inbound{Id: 3, Port: 443, Protocol: model.Trojan, StreamSettings: sharedTLSStream}

	if _, err := planSharedPort([]*model.Inbound{master, c1, c2}); err == nil {
		t.Fatal("two catch-all children should be rejected")
	}
}
