import { supabase } from "../lib/supabase"
const IDS = ["0db29f2b","00104bc1","bc0fb5b3","4bb74014","dbae3722","15050931","1ad91ccc","9c6e9721"]
for (let i=0;i<70;i++){
  await new Promise(r=>setTimeout(r,6000))
  const { data } = await supabase.from("documents")
    .select("id,status,vendor_name,total_amount,overall_confidence,doc_date,validation_issues")
    .in("status",["reviewing","approved","pushed","failed","processing"])
  const mine=(data??[]).filter(d=>IDS.some(p=>d.id.startsWith(p)))
  if (mine.length===8 && mine.every(d=>d.status!=="processing")) {
    let ok=0
    for (const d of mine.sort((a,b)=>a.id.localeCompare(b.id))) {
      const good = d.status!=="failed" && d.total_amount
      if (good) ok++
      console.log(`  ${good?"✅":"❌"} ${d.id.slice(0,8)} ${d.status.padEnd(10)} ${String(d.vendor_name??"—").slice(0,26).padEnd(27)} ฿${String(d.total_amount??"—").padStart(8)}  conf=${d.overall_confidence ?? "—"}`)
    }
    console.log(`\nกู้กลับมาได้ ${ok}/8 ใบ`)
    process.exit(0)
  }
}
console.log("หมดเวลารอ")
