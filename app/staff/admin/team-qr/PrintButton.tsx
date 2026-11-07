"use client";
import { Printer } from "lucide-react";
export default function PrintButton() { return <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full border border-[#dfe3d8] bg-white px-4 py-2.5 text-sm font-bold"><Printer size={15}/> Print / save PDF</button>; }
