#!/bin/bash
set -xe

echo "Only for local development purposes"

PASSPHRASE="$(openssl rand -base64 30)"
export PASSPHRASE=$PASSPHRASE

openssl req -subj '/CN=iongion.podman-desktop-companion' -config devtest.extensions -x509 -newkey rsa:4096 -keyout selfSignedKey.pem -out selfSigned.pem -days 365 -passout env:PASSPHRASE
openssl pkcs12 -export -out devtest.p12 -inkey selfSignedKey.pem -in selfSigned.pem -passin env:PASSPHRASE -passout env:PASSPHRASE

security import ./devtest.p12 -P "$PASSPHRASE" -A
