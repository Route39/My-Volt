import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, LayoutGrid, List, User, Package, Calendar, Paperclip } from "lucide-react";
import { toast } from "sonner";
import api from "../../lib/api";
import { StatusChip, Skeleton, EmptyState } from "../../components/common/Primitives";
import { PageHeader, PrimaryBtn, FilterChip, Field, TextInput, TextArea } from "../../components/common/Page";
import { fmtDate, inr } from "../../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";

const COLUMNS = [
  ["received", "🆕 Received"], ["processing", "⚙️ Processing"], ["on_hold", "⏸ On Hold"], ["completed", "✅ Completed"],
];
const PRIO_DOT = { urgent: "bg-red-500", high: "bg-amber-500", medium: "bg-blue-500", low: "bg-slate-400" };

function OrderCard({ o, draggable, dragId, onDragStart, onOpen }) {
  return (
    <div draggable={draggable} onDragStart={() => onDragStart && onDragStart(o.id)} onClick={() => onOpen(`/orders/${o.id}`)}
         data-testid={`order-card-${o.id}`}
         className={`mv-card p-3.5 ${draggable ? "cursor-grab active:cursor-grabbing" : ""} hover:border-mv-primary/40 transition-colors ${dragId === o.id ? "opacity-50" : "mv-rise"}`}>
      <div className="flex items-center justify-between">
        <span className="font-display font-bold text-sm">{o.order_number}</span>
        <span className={`w-2 h-2 rounded-full ${PRIO_DOT[o.priority]}`} title={o.priority} />
      </div>
      <div className="text-sm font-medium mt-1">{o.customer_name}</div>
      <div className="text-xs text-mv-muted mt-0.5 flex items-center gap-1"><Package className="w-3 h-3" /> {o.product || "—"}{o.quantity ? ` · ${o.quantity} ${o.unit || ""}` : ""}</div>
      <div className="flex items-center justify-between mt-2.5 text-xs">
        <span className="flex items-center gap-1 text-mv-dim"><Calendar className="w-3 h-3" /> {fmtDate(o.due_date)}</span>
        {o.status !== "completed" && <StatusChip status={o.due_status} />}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-mv-muted flex items-center gap-1"><User className="w-3 h-3" /> {o.assigned_to || "Unassigned"}</span>
        <div className="flex items-center gap-1.5">
          {(o.attachments?.length > 0) && <Paperclip className="w-3 h-3 text-mv-dim" />}
          <StatusChip status={o.payment_status === "paid" ? "paid" : o.payment_status === "partial" ? "partial" : "pending"} label={o.payment_status === "paid" ? "Paid" : o.payment_status === "partial" ? "Partial" : "Pending"} />
        </div>
      </div>
    </div>
  );
}

export default function Orders() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [view, setView] = useState("board");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("all");
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [dragId, setDragId] = useState(null);

  const load = useCallback(async () => {
    const p = {};
    if (params.get("status")) p.status = params.get("status");
    if (params.get("due")) p.due = params.get("due");
    if (params.get("scope")) p.scope = params.get("scope");
    if (priority !== "all") p.priority = priority;
    if (q) p.q = q;
    const { data } = await api.get("/orders", { params: p });
    setItems(data);
  }, [priority, q, params]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const move = async (o, status) => {
    if (o.status === status) return;
    setItems((its) => its.map((x) => x.id === o.id ? { ...x, status } : x));
    try { await api.put(`/orders/${o.id}`, { status }); toast.success(`✓ Order moved to ${status.replace("_", " ")}`); load(); }
    catch { toast.error("Failed to move"); load(); }
  };

  return (
    <div>
      <PageHeader title="Orders" subtitle="Order command center — receive, process, complete">
        <PrimaryBtn onClick={() => setShowNew(true)} data-testid="new-order-btn"><Plus className="w-4 h-4" /> New Order</PrimaryBtn>
      </PageHeader>

      <div className="flex flex-col lg:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="order-search" placeholder="Search order, customer, phone, fabric…"
                 className="w-full h-10 pl-9 pr-3 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-36 h-10 bg-mv-surface border-mv-border"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="all">All Priority</SelectItem>{["urgent", "high", "medium", "low"].map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex rounded-xl border border-mv-border overflow-hidden">
            <button onClick={() => setView("board")} className={`w-10 h-10 flex items-center justify-center ${view === "board" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setView("list")} data-testid="order-list-view" className={`w-10 h-10 flex items-center justify-center ${view === "list" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><List className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {!items && <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div>}
      {items && items.length === 0 && <EmptyState icon={Package} title="No orders yet." subtitle="Your studio is ready for its next order." action={<PrimaryBtn onClick={() => setShowNew(true)}><Plus className="w-4 h-4" /> New Order</PrimaryBtn>} />}

      {items && items.length > 0 && view === "board" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {COLUMNS.map(([key, label]) => {
            const col = items.filter((o) => o.status === key);
            return (
              <div key={key} onDragOver={(e) => e.preventDefault()} onDrop={() => { const o = items.find((x) => x.id === dragId); if (o) move(o, key); setDragId(null); }}
                   className="mv-card bg-mv-surface2/60 p-2.5 min-h-[200px]">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs bg-mv-elevated rounded-full px-2 py-0.5 text-mv-dim">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.map((o) => <OrderCard key={o.id} o={o} draggable dragId={dragId} onDragStart={setDragId} onOpen={nav} />)}
                  {col.length === 0 && <div className="text-[11px] text-mv-dim text-center py-6">Drop here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {items && items.length > 0 && view === "list" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((o) => <OrderCard key={o.id} o={o} onOpen={nav} />)}
        </div>
      )}

      <NewOrderDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
    </div>
  );
}

function NewOrderDialog({ open, setOpen, onDone }) {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customer_id: "", order_date: new Date().toISOString().slice(0, 10), due_date: "", product: "", quantity: "", unit: "metres", priority: "medium", assigned_to: "", payment_status: "pending", total_amount: 0, paid_amount: 0, notes: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (open) api.get("/customers").then((r) => setCustomers(r.data)); }, [open]);
  const save = async () => {
    if (!form.customer_id) { toast.error("Select a customer"); return; }
    const body = { ...form, quantity: form.quantity ? Number(form.quantity) : null, total_amount: Number(form.total_amount || 0), paid_amount: Number(form.paid_amount || 0),
      order_date: form.order_date ? new Date(form.order_date).toISOString() : null, due_date: form.due_date ? new Date(form.due_date).toISOString() : null };
    try { await api.post("/orders", body); toast.success("Order created ✓"); onDone(); } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">New Order</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <div className="col-span-2"><Field label="Customer"><Select value={form.customer_id} onValueChange={(v) => set("customer_id", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="order-customer"><SelectValue placeholder="Select customer" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-56">{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></Field></div>
          <Field label="Order Date"><TextInput type="date" value={form.order_date} onChange={(e) => set("order_date", e.target.value)} /></Field>
          <Field label="Due Date"><TextInput type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
          <Field label="Product / Fabric"><TextInput value={form.product} onChange={(e) => set("product", e.target.value)} placeholder="Floral Cotton" /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Quantity"><TextInput type="number" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} /></Field><Field label="Unit"><TextInput value={form.unit} onChange={(e) => set("unit", e.target.value)} /></Field></div>
          <Field label="Priority"><Select value={form.priority} onValueChange={(v) => set("priority", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["urgent", "high", "medium", "low"].map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Assigned Person"><TextInput value={form.assigned_to} onChange={(e) => set("assigned_to", e.target.value)} placeholder="Nandhini" /></Field>
          <Field label="Payment Status"><Select value={form.payment_status} onValueChange={(v) => set("payment_status", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["pending", "partial", "paid"].map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Total Amount (₹)"><TextInput type="number" value={form.total_amount} onChange={(e) => set("total_amount", e.target.value)} /></Field>
          <Field label="Paid Amount (₹)"><TextInput type="number" value={form.paid_amount} onChange={(e) => set("paid_amount", e.target.value)} /></Field>
          <div className="col-span-2"><Field label="Notes"><TextArea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything about this order…" /></Field></div>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-order-btn">Create Order</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
