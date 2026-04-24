'use client';
import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import dynamic from 'next/dynamic';
import '@solana/wallet-adapter-react-ui/styles.css';

const LockForm = dynamic(() => import('./LockForm'), { ssr: false });

export default function Home() {
  const endpoint = 'https://mainnet.helius-rpc.com/?api-key=108d940a-3471-4463-bb13-83e30d82de55';

  // Phantom registered explicitly; Jupiter Wallet and other Wallet-Standard wallets
  // are auto-detected via the Wallet Standard protocol when their browser extensions
  // are installed. autoConnect re-attaches the last-used wallet on page refresh.
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <LockForm />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
