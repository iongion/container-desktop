package main

import (
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestWriteKeyPair(t *testing.T) {
	tmpDir := t.TempDir()
	identityPath := filepath.Join(tmpDir, "id_rsa")
	authorizedKeysPath := filepath.Join(tmpDir, "authorized_keys")

	WriteKeyPair(identityPath, authorizedKeysPath)

	// Check private key file exists
	if _, err := os.Stat(identityPath); os.IsNotExist(err) {
		t.Error("Private key file was not created")
	}

	// Check public key file exists
	pubKeyPath := identityPath + ".pub"
	if _, err := os.Stat(pubKeyPath); os.IsNotExist(err) {
		t.Error("Public key file was not created")
	}

	// Check authorized keys file exists
	if _, err := os.Stat(authorizedKeysPath); os.IsNotExist(err) {
		t.Error("Authorized keys file was not created")
	}

	// Verify private key can be parsed
	privKeyData, err := os.ReadFile(identityPath)
	if err != nil {
		t.Fatalf("Failed to read private key: %v", err)
	}

	block, _ := pem.Decode(privKeyData)
	if block == nil {
		t.Fatal("Failed to decode private key PEM")
	}

	if block.Type != "RSA PRIVATE KEY" {
		t.Errorf("Expected RSA PRIVATE KEY, got %s", block.Type)
	}

	privKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("Failed to parse private key: %v", err)
	}

	if privKey.N.BitLen() != 4096 {
		t.Errorf("Expected 4096-bit key, got %d-bit", privKey.N.BitLen())
	}

	// Verify public key can be parsed
	pubKeyData, err := os.ReadFile(pubKeyPath)
	if err != nil {
		t.Fatalf("Failed to read public key: %v", err)
	}

	block, _ = pem.Decode(pubKeyData)
	if block == nil {
		t.Fatal("Failed to decode public key PEM")
	}

	if block.Type != "RSA PUBLIC KEY" {
		t.Errorf("Expected RSA PUBLIC KEY, got %s", block.Type)
	}

	pubKey, err := x509.ParsePKCS1PublicKey(block.Bytes)
	if err != nil {
		t.Fatalf("Failed to parse public key: %v", err)
	}

	// Verify key pair matches
	if pubKey.N.Cmp(privKey.N) != 0 {
		t.Error("Public key doesn't match private key")
	}
}

func TestReadKeys(t *testing.T) {
	tmpDir := t.TempDir()
	identityPath := filepath.Join(tmpDir, "id_rsa")
	authorizedKeysPath := filepath.Join(tmpDir, "authorized_keys")

	// Generate keys first
	WriteKeyPair(identityPath, authorizedKeysPath)

	// Read keys
	privateKey, publicKey, publicKeyPEM := ReadKeys(identityPath)

	if privateKey == nil {
		t.Fatal("Private key is nil")
	}

	if publicKey == nil {
		t.Fatal("Public key is nil")
	}

	if len(publicKeyPEM) == 0 {
		t.Fatal("Public key PEM is empty")
	}

	// Verify the keys work for SSH
	testData := []byte("test message")
	signature, err := privateKey.Sign(nil, testData)
	if err != nil {
		t.Fatalf("Failed to sign with private key: %v", err)
	}

	if signature == nil {
		t.Error("Signature is nil")
	}
}

func TestPublicPEMtoOpenSSH(t *testing.T) {
	tmpDir := t.TempDir()
	identityPath := filepath.Join(tmpDir, "id_rsa")
	authorizedKeysPath := filepath.Join(tmpDir, "authorized_keys")

	WriteKeyPair(identityPath, authorizedKeysPath)

	// Read the private key to get the public key
	privKeyData, err := os.ReadFile(identityPath)
	if err != nil {
		t.Fatalf("Failed to read private key: %v", err)
	}

	block, _ := pem.Decode(privKeyData)
	privKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("Failed to parse private key: %v", err)
	}

	// Convert to OpenSSH format
	sshKey, err := PublicPEMtoOpenSSH(&privKey.PublicKey)
	if err != nil {
		t.Fatalf("Failed to convert to OpenSSH format: %v", err)
	}

	// Verify it's valid SSH format
	_, _, _, _, err = ssh.ParseAuthorizedKey(sshKey)
	if err != nil {
		t.Fatalf("Generated SSH key is invalid: %v", err)
	}
}

func TestWriteKeyPairNoAuthorizedKeys(t *testing.T) {
	tmpDir := t.TempDir()
	identityPath := filepath.Join(tmpDir, "id_rsa")

	// Call with empty authorized keys path
	WriteKeyPair(identityPath, "")

	// Private and public keys should still be created
	if _, err := os.Stat(identityPath); os.IsNotExist(err) {
		t.Error("Private key file was not created")
	}

	pubKeyPath := identityPath + ".pub"
	if _, err := os.Stat(pubKeyPath); os.IsNotExist(err) {
		t.Error("Public key file was not created")
	}
}

func TestReadKeysNonExistent(t *testing.T) {
	// This test verifies that ReadKeys calls log.Fatal for non-existent files
	// We can't actually test log.Fatal as it calls os.Exit()
	// So we'll just skip this test and document the expected behavior
	t.Skip("ReadKeys calls log.Fatal which exits the process - behavior is documented")
}

func TestKeyPairConsistency(t *testing.T) {
	tmpDir := t.TempDir()
	identityPath := filepath.Join(tmpDir, "id_rsa")
	authorizedKeysPath := filepath.Join(tmpDir, "authorized_keys")

	// Generate keys
	WriteKeyPair(identityPath, authorizedKeysPath)

	// Read authorized keys
	authKeysData, err := os.ReadFile(authorizedKeysPath)
	if err != nil {
		t.Fatalf("Failed to read authorized keys: %v", err)
	}

	// Parse the authorized key
	authPubKey, _, _, _, err := ssh.ParseAuthorizedKey(authKeysData)
	if err != nil {
		t.Fatalf("Failed to parse authorized key: %v", err)
	}

	// Read keys using ReadKeys
	_, pubKey, pubKeyPEM := ReadKeys(identityPath)

	// Parse our public key PEM
	ourPubKey, _, _, _, err := ssh.ParseAuthorizedKey(pubKeyPEM)
	if err != nil {
		t.Fatalf("Failed to parse our public key: %v", err)
	}

	// Compare fingerprints
	authFingerprint := ssh.FingerprintSHA256(authPubKey)
	ourFingerprint := ssh.FingerprintSHA256(ourPubKey)

	if authFingerprint != ourFingerprint {
		t.Errorf("Key fingerprints don't match: auth=%s, ours=%s", authFingerprint, ourFingerprint)
	}

	// Also check the pubKey directly
	directFingerprint := ssh.FingerprintSHA256(pubKey)
	if directFingerprint != ourFingerprint {
		t.Error("Direct public key doesn't match PEM public key")
	}
}
