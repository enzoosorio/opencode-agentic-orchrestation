import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "opencode router",
  description: "Static + dynamic model routing for opencode plan GO",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
