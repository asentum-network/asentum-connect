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
  const dex = useContract('0xYourContract');
  const { balance, refresh } = useBalance();      // native ASE, wei string, polls every 12s

  async function trade() {
    if (!connected) return openConnect();
    const out = await dex.view('quote', ['1', tokenIn, amountIn]);            // read, free
    const tx  = await dex.call('swapExactIn', ['1', tokenIn, amountIn, '1']); // write, signed
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
  Soon chip).
- **`<ConnectButton>`** — the button; renders the modal automatically.
- **`<ConnectModal>`** — the modal on its own, for custom triggers.
- **`useWallet()`** → `{ address, connected, connecting, error, hasWallet, connect, disconnect, openConnect }`.
- **`useAsentum()`** → `AsentumClient` (`view`, `call`, `transfer`, `deploy`, `waitReceipt`, `balanceOf`).
- **`useContract(addr)`** → `{ address, view(method,args), call(method,args,value) }`.
- **`useBalance(addr?, pollMs?)`** → `{ balance, loading, refresh }`. `balance` is a wei decimal string.
- **`AsentumClient`** — the client class, usable without React for read-only
  scripts and back-ends. Writes need a signer, so they only work in a browser
  with the extension present or a paired Telegram session; to sign server-side
  use `@asentum/sdk`, which holds a key directly.
- **`shortAddress(addr, lead?, tail?)`** and **`DEFAULT_RPC`** — small helpers.

## How it works

Reads (`view`, `balanceOf`) hit the public RPC `/view` and `/balance`, so they
need no wallet at all. Writes are routed to whichever signer the user
connected with: the **Asentum browser extension** (`window.asentum`) or a
paired **Telegram wallet** session. Either way the user is prompted to approve,
and private keys never touch this library.

The `create-new` and `telegram` options are opt-in: the modal only shows them
if you pass `onCreateWallet` / `telegramBot` to the provider.

## License

MIT, © Asentum. Use it in your own dapp.
