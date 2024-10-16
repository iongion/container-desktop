package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"

	log "github.com/sirupsen/logrus"
	"golang.org/x/crypto/ssh"
)

func PublicPEMtoOpenSSH(rsaPubKey *rsa.PublicKey) ([]byte, error) {
	pub, err := ssh.NewPublicKey(rsaPubKey)
	if err != nil {
		return nil, err
	}
	sshPubKey := ssh.MarshalAuthorizedKey(pub)
	return sshPubKey, nil
}

func WriteKeyPair(filename string, authorizedKeysPath string) {
	baseDir := filepath.Dir(filename)
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		log.Fatalln("Error creating base directory: " + err.Error())
		return
	}

	bitSize := 4096
	// Generate RSA key.
	privateKey, err := rsa.GenerateKey(rand.Reader, bitSize)
	if err != nil {
		log.Fatalln("Error creating RSA key: " + err.Error())
	}
	// Extract public component.
	pub := privateKey.Public()
	// Encode private key to PKCS#1 ASN.1 PEM.
	privateKeyPEM := pem.EncodeToMemory(
		&pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
		},
	)
	// Encode public key to PKCS#1 ASN.1 PEM.
	publicKeyPEM := pem.EncodeToMemory(
		&pem.Block{
			Type:  "RSA PUBLIC KEY",
			Bytes: x509.MarshalPKCS1PublicKey(pub.(*rsa.PublicKey)),
		},
	)
	openSSHKey, err := PublicPEMtoOpenSSH(&privateKey.PublicKey)
	if err != nil {
		log.Fatalln("Error converting public key to OpenSSH format: ", err)
	}
	// Write private key to file.
	if err := os.WriteFile(filename, privateKeyPEM, 0700); err != nil {
		log.Fatalln("Error writing file: " + err.Error())
	}
	// Write public key to file.
	if err := os.WriteFile(filename+".pub", publicKeyPEM, 0755); err != nil {
		log.Fatalln("Error writing file: " + err.Error())
	}
	// Write to authorized keys file
	if len(authorizedKeysPath) == 0 {
		log.Warnln("No authorized keys path provided, skipping writing to authorized keys")
	} else {
		if err := os.WriteFile(authorizedKeysPath, openSSHKey, 0755); err != nil {
			log.Fatalln("Error writing file: " + err.Error())
		}
	}
}

func ReadKeys(identityPath string) (ssh.Signer, ssh.PublicKey, []byte) {
	// Read the private key from the identity path
	log.Debugln("Reading private key from", identityPath)
	hostKeyBuffer, err := os.ReadFile(identityPath)
	if err != nil {
		log.Fatalf("Unable to read private key: %v", err)
	}
	privateKey, err := ssh.ParsePrivateKey(hostKeyBuffer)
	if err != nil {
		log.Fatalf("Unable to parse private key: %v", err)
	}
	// Read the public key from the identity path
	log.Debugf("Reading public key from %s.pub", identityPath)
	pubKeyBuffer, err := os.ReadFile(fmt.Sprintf("%s.pub", identityPath))
	if err != nil {
		log.Fatalf("Unable to read public key: %v", err)
	}
	pemBlock, rest := pem.Decode(pubKeyBuffer)
	if pemBlock == nil {
		log.Fatalf("invalid PEM public key passed, pem.Decode() did not find a public key")
	}
	if len(rest) > 0 {
		log.Fatalf("PEM block contains more than just public key")
	}
	rsaPubKey, err := x509.ParsePKCS1PublicKey(pemBlock.Bytes)
	if err != nil {
		log.Fatalf("Unable to parse public key: %v", err)
	}
	publicKey, err := ssh.NewPublicKey(rsaPubKey)
	if err != nil {
		log.Fatalf("Unable to create ssh public key: %v", err)
	}
	publicKeyPEM := ssh.MarshalAuthorizedKey(publicKey)
	return privateKey, publicKey, publicKeyPEM
}
