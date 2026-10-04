# @asentum/connect

Wallet connect for **AsentumChain** dapps: a `<ConnectButton />`, a connect
modal (browser extension, Telegram, create-new), and hooks (`useWallet`,
`useAsentum`, `useContract`, `useBalance`). No CSS to import, react as the only
peer dep. Styling is via props and inline styles.

```bash
npm install @asentum/connect
```

Full guide with worked examples:
<https://asentum.com/docs/guides/wallet-connect>

## Quick start

Wrap your app once, then drop the button anywhere:

```tsx
import { AsentumProvider, ConnectButton } from '@asentum/connect';

export default function App({ children }) {
  return (
    <AsentumProvider
      rpc="https://testnet.asentum.com"
      dappName="My Dapp"                       // shown in the wallet's approval prompt
      telegramBot="AsentumWalletBot"           // optional: adds the Telegram option
      onConnect={(address) => console.log('linked', address)}
    >
      <ConnectButton />
      {children}
    </AsentumProvider>
  );
}
```

In Next.js the provider is a client component, so it needs `'use client'` at
the top of the file that renders it.

### Styling the button

```tsx
<ConnectButton text="Sign in" bg="#111318" color="#fff" border="1px solid #333" radius={8} />
```

Props: `text`, `bg`, `color`, `border`, `radius`, `menu` (copy/disconnect menu
when connected, on by default; with it off a second click disconnects), plus
`className` / `style` escape hatches. `style` is merged last, so it wins over
every other prop.

The modal itself is not themeable. It is deliberately the same across Asentum
dapps so users recognise it. For a different look, use your own trigger.

### Your own trigger

`<ConnectButton>` renders the modal for you. If you replace the button with
your own markup, mount `<ConnectModal />` yourself once inside the provider,
or nothing will open:

```tsx
import { ConnectModal, useWallet } from '@asentum/connect';

function Header() {
  const { connected, address, openConnect, disconnect } = useWallet();
  return (
    <>
      {connected
        ? <button onClick={disconnect}>{address.slice(0, 10)}…</button>
        : <button onClick={openConnect}>Connect</button>}
      <ConnectModal />
    </>
  );
}
```

## Hooks

```tsx
import { useWallet, useAsentum, useContract, useBalance } from '@asentum/connect';

function Swap() {
  const { address, connected, openConnect } = useWallet();
  const client = useAsentum();
  const dex = useContract('ase1yourcontract...');
  const { balance, refresh } = useBalance();      // native ASE, wei string, polls every 12s

  async function trade() {
    if (!connected) return openConnect();
    const out = BigInt(await dex.view('quote', ['1', tokenIn, amountIn]));   // read, free
    const minOut = (out * 9900n) / 10000n;                                     // 1% slippage, from the quote shown
    const tx  = await dex.call('swapExactIn', ['1', tokenIn, amountIn, minOut.toString()]); // write, signed
    const receipt = await client.waitReceipt(tx);
    if (!receipt.success) throw new Error('swap reverted');
    refresh();
  }
}
```

## API

- **`<AsentumProvider>`** — `rpc?` (default `https://testnet.asentum.com`),
  `dappName?`, `telegramBot?`, `botApi?` (default
  `https://wallet.asentum.com`), `onCreateWallet?`, `onConnect?`,
  `onDisconnect?`, `persist?` (remember the address across page loads, on by
  default), `extensionStatus?` (`'ready'` by default: the browser-extension
  option is offered and connectable; pass `'soon'` to render it disabled with a
  Soon chip), `allowCustomRpc?` (on by default: lets the person using your
  dapp point reads at their own node; see "Custom RPC" below).
- **`<ConnectButton>`** — the button; renders the modal automatically.
- **`<ConnectModal>`** — the modal on its own, for custom triggers.
- **`useWallet()`** → `{ address, ase1Address, connected, connecting, error, hasWallet, connect, disconnect, openConnect }`.
- **`useAsentum()`** → `AsentumClient` (`view`, `call`, `transfer`, `deploy`, `waitReceipt`, `balanceOf`).
- **`useContract(addr)`** → `{ address, view(method,args), call(method,args,value) }`.
- **`useBalance(addr?, pollMs?)`** → `{ balance, loading, refresh }`. `balance` is a wei decimal string.
- **`useRpc()`** → `{ rpc, defaultRpc, isCustom, allowed, failing, readingFromDefault, setRpc(url), resetRpc(), readFromDefault(on) }`. `setRpc` resolves to `{ ok, height?, error?, checks?, note? }`.
- **`<NetworkSettings />`**: the Network row on its own, for custom menus.
- **`normalizeRpcUrl`, `validateRpc`, `formatHeight`**: the checks `setRpc` runs, usable on their own.
- **`AsentumClient`** — the client class, usable without React for read-only
  scripts and back-ends. Writes need a signer, so they only work in a browser
  with the extension present or a paired Telegram session; to sign server-side
  use `@asentum/sdk`, which holds a key directly.
- **`shortAddress(addr, lead?, tail?)`** and **`DEFAULT_RPC`** — small helpers. `shortAddress` always renders ase1.
- **`toAse1`, `hexToAse1`, `ase1ToHex`, `isAse1`, `shortAse1`** — ase1 (bech32, HRP `ase`) helpers. Show users `ase1Address` or `toAse1(x)`; never show hex. `address` stays in the form the wallet returned it, for RPC calls. Client methods accept ase1 or hex addresses.

## How it works

Reads (`view`, `balanceOf`) hit the RPC's `/view` and `/balance` (your `rpc`,
or the user's own node if they chose one), so they need no wallet at all. Writes are routed to whichever signer the user
connected with: the **Asentum browser extension** (`window.asentum`) or a
paired **Telegram wallet** session. Either way the user is prompted to approve,
and private keys never touch this library.

## Custom RPC

Anyone can run an Asentum node, and validators often serve their own RPC. With
`allowCustomRpc` on (the default) the person using your dapp can switch to
their own node from the **Network** row in the connected menu of
`<ConnectButton>` (also shown at the bottom of the connect modal): **Change**,
paste the address, **Save**. **Reset to default** goes back to your `rpc`.

Before saving, the kit checks the node:

1. the address is `https://` (plain `http://` is only accepted for
   `localhost`, `127.0.0.1` or a private network address, and an https page
   cannot reach a plain http node on the network anyway);
2. `GET <url>/metadata` answers within 5 seconds with chain `1423`
   (`chainIdDecimal: "1423"` or `chainId: "0x58f"`);
3. `GET <url>/v3/heads` reports a numeric finalized block height.

Trailing slashes are stripped. On success the row shows
`Connected: block 309,120`. The choice is saved in `localStorage` under
`asentum.rpc` (read after mount, so server rendering always uses your `rpc`).

What it covers:

- **Reads from this dapp**: `view`, `balanceOf`, `useBalance`, `useContract().view`
  and the receipt polling in `waitReceipt`, including after a Telegram-signed
  transaction.
- **Not extension-signed transactions.** The Asentum browser extension signs
  and sends through its own RPC setting (Settings, Network RPC, in the
  extension). The Telegram wallet likewise broadcasts through the node set in
  the Telegram wallet; the kit never passes an RPC to the signer.

If the saved node stops answering, the kit does not quietly switch to another
node. `useRpc().failing` turns true and the Network row says "Your custom RPC
is not answering. Switch back to the default?" with **Switch to default** and
**Read from default for now** (reads only, for this page load).

```tsx
import { useRpc } from '@asentum/connect';

function NodePicker() {
  const { rpc, isCustom, setRpc, resetRpc } = useRpc();
  async function use(url: string) {
    const r = await setRpc(url);
    alert(r.ok ? `Connected: block ${r.height}` : r.error);
  }
  return isCustom ? <button onClick={resetRpc}>Back to default ({rpc})</button> : null;
}
```

Pass `allowCustomRpc={false}` to keep every read on your `rpc` (the Network row
then only shows the host).

The `create-new` and `telegram` options are opt-in: the modal only shows them
if you pass `onCreateWallet` / `telegramBot` to the provider.

## License

MIT, © Asentum. Use it in your own dapp.
