import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Inbox, Loader2, CheckCircle2, PauseCircle, AlertTriangle, ArrowRight, ChevronRight, Clock } from "lucide-react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { AnimatedCounter, Skeleton, StatusChip } from "../../components/common/Primitives";
import { fmtDate, timeAgo } from "../../lib/format";

export default function NayaraDashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const nav = useNavigate();
  useEffect(() => { api.get("/order-dashboard").then((r) => setD(r.data)).catch(() => {}); }, []);

  const k = d?.kpis;
  const kpis = k ? [
    { l: "Total Orders", v: k.total, icon: ClipboardList, c: "text-mv-primary", bg: "bg-blue-500/12", to: "/orders?scope=all" },
    { l: "Received", v: k.received, icon: Inbox, c: "text-blue-500", bg: "bg-blue-500/12", to: "/orders?status=received" },
    { l: "Processing", v: k.processing, icon: Loader2, c: "text-amber-500", bg: "bg-amber-500/12", to: "/orders?status=processing" },
    { l: "Completed", v: k.completed, icon: CheckCircle2, c: "text-green-600", bg: "bg-green-500/12", to: "/orders?status=completed" },
    { l: "On Hold", v: k.on_hold, icon: PauseCircle, c: "text-slate-500", bg: "bg-slate-500/12", to: "/orders?status=on_hold" },
    { l: "Overdue", v: k.overdue, icon: AlertTriangle, c: "text-red-500", bg: "bg-red-500/12", to: "/orders?due=overdue" },
  ] : [];

  const List = ({ title, items, empty, render }) => (
    <div className="mv-card p-5 mv-rise">
      <h3 className="font-display text-lg font-semibold mb-3">{title}</h3>
      {!items ? <Skeleton className="h-24 rounded-xl" /> : items.length === 0 ? (
        <div className="py-8 text-center text-mv-dim text-sm">{empty}</div>
      ) : (
        <div className="space-y-2">
          {items.map((o) => (
            <button key={o.id} onClick={() => nav(`/orders/${o.id}`)} className="w-full flex items-center gap-3 p-3 rounded-xl bg-mv-surface2 hover:bg-mv-elevated transition-colors text-left">
              {render(o)}
              <ChevronRight className="w-4 h-4 text-mv-dim ml-auto shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="mv-rise">
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">{user?.org_name || "Nayara Studio"}</h1>
        <p className="text-mv-muted mt-1">Order Management · Welcome, {user?.name}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {!k && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {kpis.map((kp, i) => {
          const Icon = kp.icon;
          return (
            <button key={kp.l} onClick={() => nav(kp.to)} data-testid={`okpi-${kp.l.toLowerCase().replace(/ /g, "-")}`}
                    className="mv-card mv-card-hover p-4 sm:p-5 text-left mv-rise" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center justify-between">
                <div className={`w-9 h-9 rounded-xl ${kp.bg} flex items-center justify-center`}><Icon className={`w-4 h-4 ${kp.c}`} /></div>
                <ArrowRight className="w-4 h-4 text-mv-dim" />
              </div>
              <div className="font-display text-3xl font-bold mt-3"><AnimatedCounter value={kp.v} /></div>
              <div className="mv-label mt-1">{kp.l}</div>
            </button>
          );
        })}
      </div>

      {/* Pipeline */}
      <div className="mv-card p-5 sm:p-6 mv-rise">
        <h3 className="font-display text-lg font-semibold mb-4">Order Pipeline</h3>
        {!d ? <Skeleton className="h-24 rounded-xl" /> : (
          <div className="flex items-center gap-2 sm:gap-4">
            {[["Received", d.pipeline.received, "#2563eb"], ["Processing", d.pipeline.processing, "#f59e0b"], ["Completed", d.pipeline.completed, "#16a34a"]].map(([l, v, col], i) => (
              <div key={l} className="flex items-center gap-2 sm:gap-4 flex-1">
                <div className="flex-1 rounded-2xl p-4 sm:p-5 text-center" style={{ background: `${col}14` }}>
                  <div className="font-display text-3xl sm:text-4xl font-bold" style={{ color: col }}><AnimatedCounter value={v} /></div>
                  <div className="mv-label mt-1">{l}</div>
                </div>
                {i < 2 && <ArrowRight className="w-5 h-5 text-mv-dim shrink-0" />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <List title="Today's Orders" items={d?.todays} empty="No new orders today."
              render={(o) => (<><div className="font-medium text-sm">{o.order_number} · {o.customer_name}</div></>)} />
        <List title="Due Soon" items={d?.due_soon} empty="Nothing due soon."
              render={(o) => (<><div><div className="font-medium text-sm">{o.order_number} · {o.customer_name}</div><div className="text-xs text-mv-dim flex items-center gap-1"><Clock className="w-3 h-3" /> Due {fmtDate(o.due_date)}</div></div><StatusChip status={o.due_status} /></>)} />
        <List title="Recently Completed" items={d?.recent_completed} empty="No completed orders yet."
              render={(o) => (<><div className="font-medium text-sm">{o.order_number} · {o.customer_name}</div><StatusChip status="completed" /></>)} />
        <div className="mv-card p-5 mv-rise">
          <h3 className="font-display text-lg font-semibold flex items-center gap-2 mb-3"><AlertTriangle className="w-5 h-5 text-amber-500" /> Needs Attention</h3>
          {!d ? <Skeleton className="h-24 rounded-xl" /> : d.attention.length === 0 ? (
            <div className="py-8 text-center text-mv-dim text-sm">Everything looks healthy ✓</div>
          ) : (
            <div className="space-y-2">
              {d.attention.map((a, i) => (
                <button key={i} onClick={() => nav(a.link)} className="w-full flex items-center gap-3 p-3 rounded-xl bg-mv-surface2 hover:bg-mv-elevated transition-colors text-left">
                  <span className={`w-2 h-2 rounded-full ${a.level === "red" ? "bg-red-500" : "bg-amber-500"}`} />
                  <span className="text-sm flex-1">{a.label}</span>
                  <ChevronRight className="w-4 h-4 text-mv-dim" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
