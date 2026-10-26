package controller

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mhsanaei/3x-ui/v3/internal/logger"
	"github.com/mhsanaei/3x-ui/v3/internal/web/service"
)

// The client portal: a public page at /clientportal where a client signs in with
// their email and portal password to see their usage, share links and QR codes.
// It lives at the server root, outside the panel's secret web base path.

const (
	portalPath          = "/clientportal"
	portalCookie        = "azp_session"
	portalSessionTTL    = 12 * time.Hour
	portalMaxFailures   = 8
	portalFailureWindow = 15 * time.Minute
)

type portalSession struct {
	email   string
	expires time.Time
}

type portalFailures struct {
	count int
	first time.Time
}

type PortalController struct {
	portal  service.PortalService
	inbound service.InboundService

	mu       sync.Mutex
	sessions map[string]portalSession
	failures map[string]*portalFailures
}

type portalLink struct {
	Protocol string `json:"protocol"`
	Name     string `json:"name"`
	URL      string `json:"url"`
}

type portalApp struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Platform string `json:"platform"`
	URL      string `json:"url"`
}

type portalMe struct {
	Email      string       `json:"email"`
	Enable     bool         `json:"enable"`
	Up         int64        `json:"up"`
	Down       int64        `json:"down"`
	Total      int64        `json:"total"`
	ExpiryTime int64        `json:"expiryTime"`
	Links      []portalLink `json:"links"`
	Apps       []portalApp  `json:"apps"`
}

var portalSync service.PortalService

// syncPortalLogins gives new clients a portal login and drops the ones of
// deleted clients; it runs after every client change.
func syncPortalLogins() {
	go func() {
		if err := portalSync.EnsureAll(); err != nil {
			logger.Warning("client portal: sync failed:", err)
		}
		if err := portalSync.PruneOrphans(); err != nil {
			logger.Warning("client portal: prune failed:", err)
		}
	}()
}

// RegisterPortalRoutes mounts the portal on the engine root.
func RegisterPortalRoutes(engine *gin.Engine) *PortalController {
	p := &PortalController{
		sessions: map[string]portalSession{},
		failures: map[string]*portalFailures{},
	}
	if err := p.portal.EnsureAll(); err != nil {
		logger.Warning("client portal: could not create missing portal logins:", err)
	}
	engine.GET(portalPath, func(c *gin.Context) { c.Redirect(http.StatusMovedPermanently, portalPath+"/") })
	engine.GET(portalPath+"/", p.page)
	engine.POST(portalPath+"/api/login", p.login)
	engine.POST(portalPath+"/api/logout", p.logout)
	engine.GET(portalPath+"/api/me", p.me)
	return p
}

func (p *PortalController) page(c *gin.Context) {
	c.Header("Referrer-Policy", "no-referrer")
	serveDistPage(c, "portal.html")
}

func newPortalToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func portalSecureRequest(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	return isTrustedForwardedRequest(c) && strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
}

func (p *PortalController) tooManyFailures(keys ...string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	for _, key := range keys {
		f := p.failures[key]
		if f == nil {
			continue
		}
		if now.Sub(f.first) > portalFailureWindow {
			delete(p.failures, key)
			continue
		}
		if f.count >= portalMaxFailures {
			return true
		}
	}
	return false
}

func (p *PortalController) recordFailure(keys ...string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	for _, key := range keys {
		f := p.failures[key]
		if f == nil || now.Sub(f.first) > portalFailureWindow {
			p.failures[key] = &portalFailures{count: 1, first: now}
			continue
		}
		f.count++
	}
}

func (p *PortalController) clearFailures(keys ...string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, key := range keys {
		delete(p.failures, key)
	}
}

func (p *PortalController) login(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "Invalid request"})
		return
	}
	email := strings.TrimSpace(req.Username)
	ipKey := "ip:" + c.ClientIP()
	emailKey := "email:" + strings.ToLower(email)
	if p.tooManyFailures(ipKey, emailKey) {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "msg": "Too many attempts. Try again in a few minutes."})
		return
	}
	if !p.portal.Verify(email, req.Password) {
		p.recordFailure(ipKey, emailKey)
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "msg": "Invalid username or password"})
		return
	}
	p.clearFailures(ipKey, emailKey)

	token, err := newPortalToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "msg": "Could not start a session"})
		return
	}
	p.mu.Lock()
	now := time.Now()
	for k, s := range p.sessions {
		if now.After(s.expires) {
			delete(p.sessions, k)
		}
	}
	p.sessions[token] = portalSession{email: email, expires: now.Add(portalSessionTTL)}
	p.mu.Unlock()

	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(portalCookie, token, int(portalSessionTTL.Seconds()), portalPath, "", portalSecureRequest(c), true)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (p *PortalController) logout(c *gin.Context) {
	if token, err := c.Cookie(portalCookie); err == nil {
		p.mu.Lock()
		delete(p.sessions, token)
		p.mu.Unlock()
	}
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(portalCookie, "", -1, portalPath, "", portalSecureRequest(c), true)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (p *PortalController) sessionEmail(c *gin.Context) (string, bool) {
	token, err := c.Cookie(portalCookie)
	if err != nil || token == "" {
		return "", false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.sessions[token]
	if !ok || time.Now().After(s.expires) {
		delete(p.sessions, token)
		return "", false
	}
	return s.email, true
}

func (p *PortalController) me(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	email, ok := p.sessionEmail(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "msg": "Not signed in"})
		return
	}
	traffic, err := p.inbound.GetClientTrafficByEmail(email)
	if err != nil || traffic == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "msg": "Account not found"})
		return
	}
	me := portalMe{
		Email:      email,
		Enable:     traffic.Enable,
		Up:         traffic.Up,
		Down:       traffic.Down,
		Total:      traffic.Total,
		ExpiryTime: traffic.ExpiryTime,
		Links:      []portalLink{},
		Apps:       portalApps(),
	}
	if links, err := p.inbound.GetAllClientLinks(resolveHost(c), email); err == nil {
		for _, raw := range links {
			me.Links = append(me.Links, describePortalLink(raw))
		}
	} else {
		logger.Warning("client portal: links for", email, "failed:", err)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "obj": me})
}

func describePortalLink(raw string) portalLink {
	link := portalLink{URL: raw}
	if scheme, _, ok := strings.Cut(raw, "://"); ok {
		link.Protocol = strings.ToLower(scheme)
	}
	if _, fragment, ok := strings.Cut(raw, "#"); ok {
		if name, err := url.PathUnescape(fragment); err == nil {
			link.Name = name
		} else {
			link.Name = fragment
		}
	}
	if link.Name == "" {
		link.Name = strings.ToUpper(link.Protocol)
	}
	return link
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// portalApps lists the download links shown to clients. Each can be replaced from
// /etc/default/azurify-ui (PORTAL_NPV_IOS_URL, PORTAL_NPV_ANDROID_URL,
// PORTAL_NETMOD_ANDROID_URL, PORTAL_NETMOD_WINDOWS_URL); an empty value hides it.
func portalApps() []portalApp {
	apps := []portalApp{
		{ID: "npv-ios", Name: "NPV Tunnel", Platform: "iPhone / iPad", URL: envOr("PORTAL_NPV_IOS_URL", "https://apps.apple.com/app/id1629465476")},
		{ID: "npv-android", Name: "NPV Tunnel", Platform: "Android", URL: envOr("PORTAL_NPV_ANDROID_URL", "https://play.google.com/store/search?q=NPV%20Tunnel&c=apps")},
		{ID: "netmod-android", Name: "NetMod", Platform: "Android", URL: envOr("PORTAL_NETMOD_ANDROID_URL", "https://play.google.com/store/apps/details?id=com.netmod.syna")},
		{ID: "netmod-windows", Name: "NetMod", Platform: "Windows", URL: envOr("PORTAL_NETMOD_WINDOWS_URL", "")},
	}
	out := apps[:0]
	for _, a := range apps {
		if a.URL != "" {
			out = append(out, a)
		}
	}
	return out
}
