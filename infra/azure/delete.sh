#!/usr/bin/env bash
# Deletes the oovi runner's whole resource group on Azure (the VM, its disk, IP address and network): nothing is
# kept on the server, so nothing is lost (chats and jobs live in the website's database).
#
#   bash infra/azure/delete.sh            (asks you to type the group's name)
#   RG=oovi-runner-rg bash infra/azure/delete.sh
set -euo pipefail
RG="${RG:-oovi-runner-rg}"
die() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
command -v az >/dev/null || die "the Azure CLI (az) is needed: use Azure Cloud Shell, or install it and run az login"
az account show -o none 2>/dev/null || die "not signed in: run az login"
[ "$(az group exists -n "$RG")" = "true" ] || { echo "Nothing to delete: $RG does not exist."; exit 0; }
# Only a group create.sh made (tagged app=oovi-runner) is deleted by this script.
[ "$(az group show -n "$RG" --query tags.app -o tsv)" = "oovi-runner" ] || die "$RG was not made by infra/azure/create.sh (no tag app=oovi-runner); delete it in the Azure portal if you are sure"
echo "In $RG:"
az resource list -g "$RG" --query "[].{type:type, name:name}" -o table
read -r -p "Type the group's name ($RG) to delete all of it: " answer
[ "$answer" = "$RG" ] || die "the name did not match; nothing was deleted"
az group delete -n "$RG" --yes
echo "Deleted $RG. Billing for it stops now."
