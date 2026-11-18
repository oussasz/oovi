#!/usr/bin/env bash
# Lets SSH in from another IP address (yours changed, or a new Cloud Shell session). Only that address is allowed.
#   bash infra/azure/allow-ssh.sh 203.0.113.8
set -euo pipefail
RG="${RG:-oovi-runner-rg}"
VM="${VM:-oovi-runner-1}"
IP="${1:-}"
[[ "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$ ]] || { echo "Give the IP address, e.g. bash infra/azure/allow-ssh.sh 203.0.113.8 (find yours at https://ifconfig.me)"; exit 1; }
az network nsg rule update -g "$RG" --nsg-name "$VM-nsg" -n ssh-from-owner --source-address-prefixes "$IP" -o none
echo "SSH now allowed only from $IP."
