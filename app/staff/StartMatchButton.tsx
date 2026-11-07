"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

export default function StartMatchButton({ matchId }: { matchId: string }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(""); const router=useRouter();
  async function start(){setBusy(true);setError("");try{const response=await fetch(`/api/matches/${matchId}/start`,{method:"POST"});const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not start match");router.refresh();}catch(e){setError(e instanceof Error?e.message:"Could not start match");}finally{setBusy(false);}}
  return <div><button onClick={()=>void start()} disabled={busy} className="flex items-center gap-2 rounded-xl bg-[#172118] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Play size={13}/>{busy?"Starting…":"Start match"}</button>{error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}</div>;
}
