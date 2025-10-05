const json = (data, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers }});

const withCors = (res) =>
  new Response(res.body, { status: res.status, headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    ...Object.fromEntries(res.headers),
  }});

async function sb(request, env, path, init = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1${path}`;
  const headers = { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json", ...init.headers };
  const r = await fetch(url, { ...init, headers });
  if (!r.ok) { const t = await r.text().catch(()=> ""); throw new Error(`Supabase ${r.status}: ${t || r.statusText}`); }
  const ct = r.headers.get("content-type") || ""; return ct.includes("application/json") ? r.json() : r.text();
}

function makeBasicAuth(env){
  if (env.TWILIO_API_KEY && env.TWILIO_API_SECRET) return `Basic ${btoa(`${env.TWILIO_API_KEY}:${env.TWILIO_API_SECRET}`)}`;
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) return `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
  throw new Error("Credenciais Twilio ausentes");
}

async function sendWhatsApp(env, to, body){
  if(!env.TWILIO_ACCOUNT_SID) throw new Error("TWILIO_ACCOUNT_SID ausente");
  if(!env.TWILIO_WHATSAPP_FROM) throw new Error("TWILIO_WHATSAPP_FROM ausente");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams({ From: env.TWILIO_WHATSAPP_FROM, To: to, Body: body });
  const r = await fetch(url, { method:"POST", headers:{ Authorization: makeBasicAuth(env), "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8" }, body: form.toString() });
  const text = await r.text(); if(!r.ok) throw new Error(`Twilio ${r.status} → ${text}`); try{ return JSON.parse(text);}catch{ return { ok:true, raw:text }; }
}

export default {
  async fetch(request, env){
    if(request.method==="OPTIONS") return withCors(new Response(null,{status:204,headers:{"access-control-max-age":"86400"}}));
    const { pathname, searchParams } = new URL(request.url);

    try{
      if(pathname==="/" || pathname==="/healthz") return withCors(json({ ok:true, now:new Date().toISOString() }));

      if(pathname==="/env") return withCors(json({
        supabase:{ url: env.SUPABASE_URL || null, hasKey: !!env.SUPABASE_KEY },
        twilio:{ accountSidSet: !!env.TWILIO_ACCOUNT_SID, from: env.TWILIO_WHATSAPP_FROM || null, usingApiKey: !!env.TWILIO_API_KEY && !!env.TWILIO_API_SECRET, usingAuthToken: !!env.TWILIO_AUTH_TOKEN }
      }));

      if(pathname==="/whatsapp/test" && request.method==="GET"){
        const to = searchParams.get("to"); const msg = searchParams.get("msg") || "VAIJÁ: teste via Twilio Sandbox ✅";
        if(!to) return withCors(json({ error:"to obrigatório: whatsapp:+55SEUNUMERO" },{status:400}));
        const result = await sendWhatsApp(env, to, msg); return withCors(json({ sent:true, result }));
      }

      if(pathname==="/criar-entrega" && request.method==="POST"){
        const body = await request.json().catch(()=>({}));
        if(!body?.origem || !body?.destino) return withCors(json({ error:"origem/destino obrigatórios" },{status:400}));
        const payload = {
          status:"buscando",
          cliente_nome: body?.cliente?.nome || null, cliente_fone: body?.cliente?.fone || null,
          origem_lat: body.origem.lat, origem_lng: body.origem.lng, origem_endereco: body.origem.endereco || null,
          destino_lat: body.destino.lat, destino_lng: body.destino.lng, destino_endereco: body.destino.endereco || null,
          preco: body?.preco ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        const rows = await sb(request, env, `/entregas`, { method:"POST", body: JSON.stringify(payload), headers:{ Prefer:"return=representation" }});
        const entrega = Array.isArray(rows) ? rows[0] : rows; return withCors(json({ ok:true, entrega }));
      }

      if(pathname==="/aceitar-motorista" && request.method==="POST"){
        const body = await request.json().catch(()=>({})); const { entregaId, driver = {} } = body || {};
        if(!entregaId) return withCors(json({ error:"entregaId obrigatório" },{status:400}));
        const patch = { status:"aceita", driver_nome: driver.nome||null, driver_placa: driver.placa||null, driver_veiculo: driver.veiculo||null, driver_fone: driver.fone||null, driver_avatar: driver.avatar||null, updated_at:new Date().toISOString() };
        await sb(request, env, `/entregas?id=eq.${encodeURIComponent(entregaId)}`, { method:"PATCH", body: JSON.stringify(patch), headers:{ Prefer:"return=representation" }});
        return withCors(json({ ok:true }));
      }

      if(pathname==="/whatsapp/webhook"){
        if(request.method==="GET") return new Response("ok");
        if(request.method==="POST"){
          const ct = request.headers.get("content-type")||""; let payload={};
          if(ct.includes("application/x-www-form-urlencoded")){ const f=await request.formData(); payload=Object.fromEntries([...f.entries()]); }
          else if(ct.includes("application/json")){ payload=await request.json().catch(()=>({})); }
          else { payload.raw = await request.text(); }
          return withCors(json({ received:true, payload }));
        }
      }

      return withCors(json({ error:"Rota não encontrada" },{status:404}));
    }catch(err){
      return withCors(json({ error: String(err?.message||err) },{status:500}));
    }
  }
};
