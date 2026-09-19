#!/bin/zsh
set -euo pipefail

print 'Enter the ADP API client ID at the hidden password prompt.'
security add-generic-password -U -a amazon-dsp -s com.openclaw.amazon-dsp.adp-client-id -l 'OpenClaw ADP API Client ID' -T /usr/bin/security -w

print 'Enter the ADP API client secret at the hidden password prompt.'
security add-generic-password -U -a amazon-dsp -s com.openclaw.amazon-dsp.adp-client-secret -l 'OpenClaw ADP API Client Secret' -T /usr/bin/security -w

print 'ADP API credentials are stored in macOS Keychain. You may close this Terminal window.'
