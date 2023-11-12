#!/bin/sh

keyPassword="0Au0D_2s)f+r"
baseFolder="/etc/easyroam-certs"
p12File="$1"

if [ -z "$1" ]; then
	echo "Usage: $0 [p12 file]"
	exit 0
fi

if [ ! -f "$p12File" ]; then
	echo "$p12File does not exist."
	exit 1
fi

if ! command -v openssl > /dev/null 2>&1; then
    echo "Openssl not installed"
	exit 1
fi

mkdir -p "$baseFolder"

openssl pkcs12 -in "$p12File" -nokeys -password pass: | openssl x509 > "$baseFolder/easyroam_client_cert.pem"
cn=$(openssl x509 -noout -subject -in "$baseFolder/easyroam_client_cert.pem" | sed 's/.*CN = \(.*\), C.*/\1/')
openssl pkcs12 -in "$p12File" -nodes -nocerts -password pass: | openssl rsa -passout pass:"$keyPassword" -passin pass:"" -aes256 -out "$baseFolder/easyroam_client_key.pem" > /dev/null 2>&1
openssl pkcs12 -in "$p12File" -cacerts -nokeys -password pass: > "$baseFolder/easyroam_root_ca.pem"

echo "ctrl_interface=DIR=/var/run/wpa_supplicant
update_config=1
country=DE

network={
   ssid=\"eduroam\"
   scan_ssid=1
   key_mgmt=WPA-EAP
   proto=WPA2
   eap=TLS
   pairwise=CCMP
   group=CCMP
   identity=\"$cn\"
   ca_cert=\"$baseFolder/easyroam_root_ca.pem\"
   client_cert=\"$baseFolder/easyroam_client_cert.pem\"
   private_key=\"$baseFolder/easyroam_client_key.pem\"
   private_key_passwd=\"$keyPassword\"
}" > "/etc/config/wpasupplicant_peap.conf"

echo "Done"
