# Changelog

## 0.2.1 (2026-11-08)

### Fixed

- Telegram signing (`botSign`, used by every Telegram-wallet call, transfer, deploy and signMessage) gives up after 5 minutes with "Request expired after 5 minutes", and stops at once on HTTP 404 or 410 from the sign-request poll ("Sign request no longer exists. Reconnect your wallet."). Before, a 404, 410 or 5xx kept it polling every 2 s forever and the promise never settled. The interval is cleared on every exit, and a slow poll no longer overlaps the next one. 5xx, 429 and network errors are still retried until the deadline.
- `169.254.0.0/16` (link-local, which includes the cloud metadata address 169.254.169.254) no longer counts as a private LAN host: `isLocalHost` returns false for it and `normalizeRpcUrl` refuses it over plain http.

## 0.2.0

- @names (resolveRecipient, transfer to @name, primary name in useWallet and the button, register and setPrimary), signMessage for the extension and Telegram paths, optional gas limit on contract calls, browser storage access that never throws.
