package service

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"math/big"
	"strings"

	"gorm.io/gorm"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
)

// PortalService owns the client-portal logins: one generated password per client,
// stored beside (not inside) the client row.
type PortalService struct {
	clientService ClientService
}

// No 0/O/1/l/I so a password read off a screen or a chat message is not misread.
const portalPasswordAlphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const portalPasswordLength = 12

func generatePortalPassword() (string, error) {
	out := make([]byte, portalPasswordLength)
	max := big.NewInt(int64(len(portalPasswordAlphabet)))
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = portalPasswordAlphabet[n.Int64()]
	}
	return string(out), nil
}

// EnsurePassword returns the client's portal password, creating one on first use.
func (s *PortalService) EnsurePassword(email string) (string, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return "", errors.New("client email is required")
	}
	db := database.GetDB()
	var cred model.PortalCredential
	err := db.Where("email = ?", email).First(&cred).Error
	if err == nil {
		return cred.Password, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	return s.store(db, email)
}

// ResetPassword replaces the client's portal password with a new random one.
func (s *PortalService) ResetPassword(email string) (string, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return "", errors.New("client email is required")
	}
	return s.store(database.GetDB(), email)
}

func (s *PortalService) store(db *gorm.DB, email string) (string, error) {
	if _, err := s.clientService.GetRecordByEmail(nil, email); err != nil {
		return "", err
	}
	password, err := generatePortalPassword()
	if err != nil {
		return "", err
	}
	cred := model.PortalCredential{Email: email, Password: password}
	if err := db.Save(&cred).Error; err != nil {
		return "", err
	}
	return password, nil
}

// EnsureAll gives every client without a portal login one, so clients created
// before the portal existed (or by import and bulk paths) can sign in too.
func (s *PortalService) EnsureAll() error {
	db := database.GetDB()
	var emails []string
	err := db.Model(&model.ClientRecord{}).
		Where("email NOT IN (SELECT email FROM portal_credentials)").
		Pluck("email", &emails).Error
	if err != nil {
		return err
	}
	for _, email := range emails {
		if _, err := s.store(db, email); err != nil {
			return err
		}
	}
	return nil
}

// PruneOrphans drops the portal logins of clients that no longer exist.
func (s *PortalService) PruneOrphans() error {
	return database.GetDB().
		Where("email NOT IN (SELECT email FROM clients)").
		Delete(&model.PortalCredential{}).Error
}

// DeleteFor drops a removed client's portal login.
func (s *PortalService) DeleteFor(email string) error {
	return database.GetDB().Where("email = ?", strings.TrimSpace(email)).Delete(&model.PortalCredential{}).Error
}

// Verify reports whether email and password match a client's portal login. A
// client that has never had a password cannot sign in until the admin opens
// their portal details once.
func (s *PortalService) Verify(email, password string) bool {
	email = strings.TrimSpace(email)
	if email == "" || password == "" {
		return false
	}
	var cred model.PortalCredential
	if err := database.GetDB().Where("email = ?", email).First(&cred).Error; err != nil {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(cred.Password), []byte(password)) != 1 {
		return false
	}
	_, err := s.clientService.GetRecordByEmail(nil, email)
	return err == nil
}
