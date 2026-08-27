import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, Users, Phone, Building2, Mail } from "lucide-react";
import { toast } from "sonner";
import api from "../../lib/api";
import { Skeleton, EmptyState } from "../../components/common/Primitives";
import { PageHeader, PrimaryBtn, Field, TextInput, TextArea } from "../../components/common/Page";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";

export default function Customers() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(params.get("new") === "1");

  const load = useCallback(async () => {
    const { data } = await api.get("/customers", { params: q ? { q } : {} }); setItems(data);
  }, [q]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  return (
    <div>
      <PageHeader title="Customers" subtitle="Your boutiques, retailers and buyers">
        <PrimaryBtn onClick={() => setShowNew(true)} data-testid="add-customer-btn"><Plus className="w-4 h-4" /> New Customer</PrimaryBtn>
      </PageHeader>

      <div className="relative flex-1 max-w-md mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="customer-search" placeholder="Search name, phone, company…"
               className="w-full h-10 pl-9 pr-3 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm" />
      </div>

      {!items && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>}
      {items && items.length === 0 && <EmptyState icon={Users} title="No customers yet." subtitle="Add your first customer to start taking orders." action={<PrimaryBtn onClick={() => setShowNew(true)}><Plus className="w-4 h-4" /> New Customer</PrimaryBtn>} />}
      {items && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((c, i) => (
            <button key={c.id} onClick={() => nav(`/customers/${c.id}`)} data-testid={`customer-card-${c.id}`}
                    className="mv-card mv-card-hover p-5 text-left mv-rise" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-blue-500/12 flex items-center justify-center"><Building2 className="w-5 h-5 text-mv-primary" /></div>
                <div className="min-w-0"><div className="font-display font-semibold truncate">{c.name}</div><div className="text-xs text-mv-dim">{c.order_count} order(s)</div></div>
              </div>
              <div className="mt-4 space-y-1.5 text-xs text-mv-muted">
                <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" /> {c.phone || "—"}</div>
                <div className="flex items-center gap-2 truncate"><Mail className="w-3.5 h-3.5" /> {c.email || "—"}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <NewCustomerDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
    </div>
  );
}

function NewCustomerDialog({ open, setOpen, onDone }) {
  const [form, setForm] = useState({ name: "", phone: "", whatsapp: "", email: "", company: "", address: "", notes: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => { if (!form.name) { toast.error("Name required"); return; } try { await api.post("/customers", form); toast.success("Customer added ✓"); onDone(); } catch { toast.error("Failed"); } };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">New Customer</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Name"><TextInput value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="customer-name" /></Field>
          <Field label="Company"><TextInput value={form.company} onChange={(e) => set("company", e.target.value)} /></Field>
          <Field label="Phone"><TextInput value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="WhatsApp"><TextInput value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
          <Field label="Email"><TextInput value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Address"><TextInput value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <div className="col-span-2"><Field label="Notes"><TextArea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-customer-btn">Add Customer</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
