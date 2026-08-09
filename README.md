# @asentum/connect

Wallet connect for **AsentumChain** dapps: a `<ConnectButton />`, a connect
modal (browser extension, Telegram, create-new), and hooks (`useWallet`,
`useAsentum`, `useContract`, `useBalance`). No CSS to import, react as the only
peer dep — styling is via props and inline styles.

```bash
npm install @asentum/connect
```

## Quick start

Wrap your app once, then drop the button anywhere:

```tsx
import { AsentumProvider, ConnectButton } from '@asentum/connect';

export default function App({ children }) {
  return (
    <AsentumProvider
      rpc="https://testnet.asentum.com"
      telegramBot="AsentumWalletBot"           // optional: adds the Telegram option
      onConnect={(address) => console.log('linked', address)}
    >
      <ConnectButton />
      {children}
    </AsentumProvider>
  );
}
```

### Styling the button

```tsx
<ConnectButton text="Sign in" bg="#111318" color="#fff" border="1px solid #333" radius={8} />
```

Props: `text`, `bg`, `color`, `border`, `radius`, `menu` (show copy/disconnect
menu when connected), plus `className` / `style` escape hatches.

## Hooks

```tsx
import { useWallet, useAsentum, useContract, useBalance } from '@asentum/connect';

function Swap() {
  const { address, connected, connect, disconnect } = useWallet();
  const dex = useContract('0xYourContract');
  const { balance } = useBalance();               // native ASE of the connected wallet

  async function trade() {
    const out = await dex.view('quote', ['1', tokenIn, amountIn]);   // read, free
    const tx  = await dex.call('swapExactIn', ['1', tokenIn, amountIn, '1']); // write, signed
    // useAsentum() also gives client.waitReceipt(tx), client.view(...), client.transfer(...)
  }
}
```

## API

- **`<AsentumProvider>`** — `rpc?`, `telegramBot?`, `onCreateWallet?`, `onConnect?`, `onDisconnect?`, `persist?`.
- **`<ConnectButton>`** — the button; renders the modal automatically.
- **`useWallet()`** → `{ address, connected, connecting, error, hasWallet, connect, disconnect, openConnect }`.
- **`useAsentum()`** → `AsentumClient` (`view`, `call`, `transfer`, `deploy`, `waitReceipt`, `balanceOf`).
- **`useContract(addr)`** → `{ view(method,args), call(method,args,value) }`.
- **`useBalance(addr?)`** → `{ balance, loading, refresh }`.
- **`AsentumClient`** — usable without React for scripts/back-ends.

## How it works

Reads (`view`, `balanceOf`) hit the public RPC `/view` and `/balance` — no
wallet needed. Writes go through the **Asentum browser extension**
(`window.asentum`), which prompts the user to sign. Private keys never touch
this library. The `create-new` and `telegram` options are opt-in: the modal
only shows them if you pass `onCreateWallet` / `telegramBot` to the provider.

## License

MIT — © Asentum. Use it in your own dapp.
