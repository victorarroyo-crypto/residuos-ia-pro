import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResidusIA Pro",
  description: "Plataforma de consultoría de gestión de residuos industriales",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
