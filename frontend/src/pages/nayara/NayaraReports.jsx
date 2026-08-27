import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { ClipboardList, Users, User, Calendar, AlertTriangle } from "lucide-react";
import api from "../../lib/api";
import { Skeleton } from "../../components/common/Primitives";
import { PageHeader } from "../../components/common/Page";

const STATUS_COLORS = { received: "#2563eb", processing: "#f59e0b", on_hold: "#94a3b8", completed: "#16a34a" };

export default function NayaraReports() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/order-reports").then((r) => setD(r.data)); }, []);
  if (!d) return <div className="space-y-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>;

  const statusData = Object.entries(d.by_status).map(([k, v]) => ({ name: k.replace("_", " "), key: k, count: v }));
  const Chart = ({ title, data, color }) => (
    <div className="mv-card p-5">
      <h3 className="font-display font-semibold mb-4">{title}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
            <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} width={110} />
            <Tooltip cursor={{ fill: "#0f172a08" }} contentStyle={{ background: "#fff", border: "1px solid #e6e8ee", borderRadius: 12, color: "#0f172a" }} />
            <Bar dataKey="count" fill={color} radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Reports" subtitle="Simple order insights" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[["Total Orders", d.total, ClipboardList, "text-mv-primary"], ["Completed", d.by_status.completed, ClipboardList, "text-green-600"], ["Processing", d.by_status.processing, ClipboardList, "text-amber-500"], ["Overdue", d.overdue, AlertTriangle, "text-red-500"]].map(([l, v, Icon, c]) => (
          <div key={l} className="mv-card p-4"><div className="mv-label flex items-center gap-1.5"><Icon className={`w-4 h-4 ${c}`} /> {l}</div><div className={`font-display text-2xl font-bold mt-1 ${c}`}>{v}</div></div>
        ))}
      </div>

      <div className="mv-card p-5 mb-4">
        <h3 className="font-display font-semibold mb-4">Orders by Status</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statusData}>
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} className="capitalize" />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "#0f172a08" }} contentStyle={{ background: "#fff", border: "1px solid #e6e8ee", borderRadius: 12, color: "#0f172a" }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>{statusData.map((e) => <Cell key={e.key} fill={STATUS_COLORS[e.key]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Chart title="Orders by Assigned Person" data={d.by_assignee} color="#2563eb" />
        <Chart title="Orders by Customer" data={d.by_customer} color="#16a34a" />
      </div>
      {d.by_month.length > 0 && <div className="mt-4"><Chart title="Orders by Month" data={d.by_month} color="#f59e0b" /></div>}
    </div>
  );
}
