import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Phone, Mail, MapPin, Package } from "lucide-react";
import api from "../../lib/api";
import { StatusChip, Skeleton } from "../../components/common/Primitives";
import { fmtDate } from "../../lib/format";

export default function CustomerProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState(null);
  const load = useCallback(async () => { const { data } = await api.get(`/customers/${id}`); setC(data); }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!c) return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;

  return (
    <div>
      <button onClick={() => nav("/customers")} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Customers</button>

      <div className="mv-card p-6 flex flex-col sm:flex-row sm:items-center gap-4 mv-rise">
        <div className="w-16 h-16 rounded-2xl bg-blue-500/12 flex items-center justify-center shrink-0"><Building2 className="w-8 h-8 text-mv-primary" /></div>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold">{c.name}</h1>
          <div className="flex items-center gap-5 mt-2 text-sm text-mv-muted flex-wrap">
            {c.phone && <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> {c.phone}</span>}
            {c.email && <span className="flex items-center gap-1.5"><Mail className="w-4 h-4" /> {c.email}</span>}
            {c.address && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {c.address}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {[["Total Orders", c.counts.total], ["Completed", c.counts.completed], ["Processing", c.counts.processing], ["On Hold", c.counts.on_hold]].map(([k, v]) => (
          <div key={k} className="mv-card p-4"><div className="mv-label">{k}</div><div className="font-display text-2xl font-bold mt-1">{v}</div></div>
        ))}
      </div>

      {c.notes && <div className="mv-card p-5 mt-4"><div className="mv-label mb-1">Notes</div><p className="text-sm text-mv-muted">{c.notes}</p></div>}

      <h3 className="font-display font-semibold mt-6 mb-3">Orders</h3>
      {c.orders.length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No orders from this customer yet.</div> : (
        <div className="mv-card divide-y divide-mv-border">
          {c.orders.map((o) => (
            <button key={o.id} onClick={() => nav(`/orders/${o.id}`)} className="w-full p-4 flex items-center justify-between hover:bg-mv-elevated transition-colors text-left">
              <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-mv-surface2 border border-mv-border flex items-center justify-center"><Package className="w-4 h-4 text-mv-dim" /></div>
                <div><div className="font-medium">{o.order_number} · {o.product || "—"}</div><div className="text-xs text-mv-dim">Due {fmtDate(o.due_date)}</div></div></div>
              <StatusChip status={o.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
