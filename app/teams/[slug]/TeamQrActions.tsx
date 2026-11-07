"use client";

import { Download, Printer } from "lucide-react";

export default function TeamQrActions({ qrDataUrl, slug }: { qrDataUrl: string; slug: string }) {
  return <div className="mt-4 flex flex-wrap gap-2 print:hidden"><a download={`youpulse-${slug}-qr.png`} href={qrDataUrl} className="inline-flex items-center gap-2 rounded-full bg-[#172118] px-4 py-2.5 text-sm font-bold text-white"><Download size={15}/> Download PNG</a><button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full border border-[#dfe3d8] bg-white px-4 py-2.5 text-sm font-bold"><Printer size={15}/> Print team card</button></div>;
}
