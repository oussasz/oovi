#!/usr/bin/env bash
# Creates the oovi cloud runner on Azure: one resource group with one small Ubuntu 24.04 VM that sets itself up
# with infra/setup.sh at its first start. No port is open except SSH, and only from the IP address you give.
#
#   bash infra/azure/create.sh 203.0.113.7
#
# Run it in Azure Cloud Shell (portal.azure.com, the >_ button at the top) after uploading this repository's
# infra/ folder, or on a computer with the Azure CLI after `az login`. Then, over SSH: sudo oovi-runner config
#
# Size: Standard_B1ms (1 vCPU, 2 GiB): two jobs at a time (one job's server peaks near 220 MB, measured
# 2026-11-18). Price list read 2026-11-18 (prices.azure.com, francecentral, Linux, pay as you go):
#   VM B1ms $0.0236/h ≈ $17.23/month · Standard SSD E4 (32 GB) $2.64/month · Standard static IPv4 $0.005/h ≈ $3.65/month
#   ≈ $23.50/month in all. On the student credit (about $43): delete it after each trial (infra/azure/delete.sh).
# Other sizes: SIZE=Standard_B2als_v2 (2 vCPU, 4 GiB, $0.0425/h ≈ $31/month VM) for four jobs at a time.
#
# Azure for Students allows only some regions and sizes (read 2026-11-19 from the subscription's policy and
# `az vm list-skus`): regions norwayeast, germanywestcentral, swedencentral, polandcentral, italynorth; no
# B-series v1 there. Used for oovi's first server: LOCATION=swedencentral SIZE=Standard_B2ats_v2 (2 vCPU, 1 GiB,
# $0.00972/h ≈ $7.10/month; with disk and IP ≈ $13.40/month; setup.sh adds 2 GB of swap on servers under 2 GB).
# Without SSH (e.g. from a machine that can't reach port 22), give 127.0.0.1/32 and configure with
# `az vm run-command invoke … --command-id RunShellScript`.
# Settings (environment): RG (oovi-runner-rg), LOCATION (francecentral), VM (oovi-runner-1), SIZE, ADMIN (oovi),
# SSH_KEY (a public key file, e.g. ~/.ssh/id_ed25519.pub from your own computer; default: this shell's own key,
# made if missing). In Cloud Shell, the simplest is to allow Cloud Shell itself and SSH from there:
#   bash infra/azure/create.sh "$(curl -s https://ifconfig.me)"
# Its address can change in a later session: infra/azure/allow-ssh.sh NEW_IP updates the rule.
set -euo pipefail

RG="${RG:-oovi-runner-rg}"
LOCATION="${LOCATION:-francecentral}"
VM="${VM:-oovi-runner-1}"
SIZE="${SIZE:-Standard_B1ms}"
ADMIN="${ADMIN:-oovi}"
SSH_IP="${1:-${SSH_IP:-}}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SETUP="$HERE/../setup.sh"

die() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
[[ "$SSH_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$ ]] || die "give the IP address SSH may come from, e.g. bash infra/azure/create.sh 203.0.113.7 (find yours at https://ifconfig.me)"
[ -f "$SETUP" ] || die "infra/setup.sh not found next to this script"
command -v az >/dev/null || die "the Azure CLI (az) is needed: use Azure Cloud Shell, or install it and run az login"
az account show -o none 2>/dev/null || die "not signed in: run az login"
if [ "$(az group exists -n "$RG")" = "true" ]; then die "the resource group $RG already exists (delete it first with infra/azure/delete.sh, or set RG=another-name)"; fi

if [ -n "${SSH_KEY:-}" ]; then [ -f "$SSH_KEY" ] || die "SSH_KEY file not found: $SSH_KEY"; KEY_ARGS="--ssh-key-values $SSH_KEY"; else KEY_ARGS="--generate-ssh-keys"; fi
echo "Subscription: $(az account show --query name -o tsv)"
echo "Creating $VM ($SIZE) in $LOCATION, resource group $RG; SSH only from $SSH_IP"

az group create -n "$RG" -l "$LOCATION" --tags app=oovi-runner -o none
az network nsg create -g "$RG" -n "$VM-nsg" -l "$LOCATION" -o none
az network nsg rule create -g "$RG" --nsg-name "$VM-nsg" -n ssh-from-owner --priority 100 --direction Inbound --access Allow --protocol Tcp \
  --source-address-prefixes "$SSH_IP" --destination-port-ranges 22 -o none

# cloud-init: the setup script runs once at first start (it installs everything and waits for its settings).
INIT="$(mktemp)"
trap 'rm -f "$INIT"' EXIT
{
  echo "#cloud-config"
  echo "write_files:"
  echo "  - path: /var/lib/oovi/setup.sh"
  echo "    permissions: '0755'"
  echo "    encoding: b64"
  echo "    content: $(base64 -w0 < "$SETUP")"
  echo "runcmd:"
  echo "  - [bash, /var/lib/oovi/setup.sh]"
} > "$INIT"

az vm create -g "$RG" -n "$VM" -l "$LOCATION" --size "$SIZE" \
  --image Canonical:ubuntu-24_04-lts:server:latest \
  --admin-username "$ADMIN" $KEY_ARGS \
  --nsg "$VM-nsg" --public-ip-sku Standard --public-ip-address-allocation static \
  --storage-sku StandardSSD_LRS --os-disk-size-gb 32 --os-disk-delete-option Delete --nic-delete-option Delete \
  --custom-data "$INIT" --tags app=oovi-runner -o none

IP="$(az vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv)"
cat <<DONE

Created. The server is setting itself up (about 3 minutes).
Next, from the computer whose IP you gave:
  ssh $ADMIN@$IP
  sudo cloud-init status --wait      (waits for the setup to finish)
  sudo oovi-runner config            (website address and RUNNER_SECRET; then it starts)
  sudo oovi-runner status
To remove everything (and stop paying): bash infra/azure/delete.sh
DONE
