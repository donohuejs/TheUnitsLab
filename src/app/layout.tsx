import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Private virtual-unit sports performance and wager tracker",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
