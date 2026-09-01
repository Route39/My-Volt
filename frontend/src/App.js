import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppProvider } from "@/context/AppContext";
import AppShell from "@/components/layout/AppShell";
import { Loader2 } from "lucide-react";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Fleet from "@/pages/Fleet";
import VehicleProfile from "@/pages/VehicleProfile";
import Drivers from "@/pages/Drivers";
import DriverProfile from "@/pages/DriverProfile";
import Rentals from "@/pages/Rentals";
import RentalCreate from "@/pages/RentalCreate";
import RentalProfile from "@/pages/RentalProfile";
import ServiceRequests from "@/pages/ServiceRequests";
import VehicleService from "@/pages/VehicleService";
import Locations from "@/pages/Locations";
import Documents from "@/pages/Documents";
import Incidents from "@/pages/Incidents";
import VehicleHealth from "@/pages/VehicleHealth";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import Tasks from "@/pages/Tasks";
import PlatformApp from "@/pages/platform/PlatformApp";

import NayaraDashboard from "@/pages/nayara/NayaraDashboard";
import Orders from "@/pages/nayara/Orders";
import OrderDetail from "@/pages/nayara/OrderDetail";
import Customers from "@/pages/nayara/Customers";
import CustomerProfile from "@/pages/nayara/CustomerProfile";
import NayaraReports from "@/pages/nayara/NayaraReports";

const isFabric = (u) => u?.industry === "fabric_order_management";

const FLEET_PATHS = ["/fleet", "/drivers", "/rentals", "/service-requests", "/vehicle-service", "/locations", "/documents", "/incidents", "/vehicle-health"];
const FABRIC_PATHS = ["/orders", "/customers"];

function Protected({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading || user === null)
    return <div className="min-h-screen flex items-center justify-center bg-mv-bg"><Loader2 className="w-6 h-6 animate-spin text-mv-primary" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  const fabric = isFabric(user);
  const p = loc.pathname;
  if (fabric && FLEET_PATHS.some((x) => p.startsWith(x))) return <Navigate to="/dashboard" replace />;
  if (!fabric && FABRIC_PATHS.some((x) => p.startsWith(x))) return <Navigate to="/dashboard" replace />;
  return <AppShell>{children}</AppShell>;
}

function DashboardRouter() { const { user } = useAuth(); return isFabric(user) ? <NayaraDashboard /> : <Dashboard />; }
function ReportsRouter() { const { user } = useAuth(); return isFabric(user) ? <NayaraReports /> : <Reports />; }

function Shell() {
  const { user, loading } = useAuth();
  if (loading)
    return <div className="min-h-screen flex items-center justify-center bg-mv-bg"><Loader2 className="w-6 h-6 animate-spin text-mv-primary" /></div>;
  if (user && user.role === "platform_admin") return <PlatformApp />;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Protected><DashboardRouter /></Protected>} />
      <Route path="/reports" element={<Protected><ReportsRouter /></Protected>} />
      <Route path="/tasks" element={<Protected><Tasks /></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />

      {/* Fleet (Route39) */}
      <Route path="/fleet" element={<Protected><Fleet /></Protected>} />
      <Route path="/fleet/:id" element={<Protected><VehicleProfile /></Protected>} />
      <Route path="/drivers" element={<Protected><Drivers /></Protected>} />
      <Route path="/drivers/:id" element={<Protected><DriverProfile /></Protected>} />
      <Route path="/rentals" element={<Protected><Rentals /></Protected>} />
      <Route path="/rentals/new" element={<Protected><RentalCreate /></Protected>} />
      <Route path="/rentals/:id" element={<Protected><RentalProfile /></Protected>} />
      <Route path="/service-requests" element={<Protected><ServiceRequests /></Protected>} />
      <Route path="/vehicle-service" element={<Protected><VehicleService /></Protected>} />
      <Route path="/locations" element={<Protected><Locations /></Protected>} />
      <Route path="/documents" element={<Protected><Documents /></Protected>} />
      <Route path="/incidents" element={<Protected><Incidents /></Protected>} />
      <Route path="/vehicle-health" element={<Protected><VehicleHealth /></Protected>} />

      {/* Nayara Studio */}
      <Route path="/orders" element={<Protected><Orders /></Protected>} />
      <Route path="/orders/:id" element={<Protected><OrderDetail /></Protected>} />
      <Route path="/customers" element={<Protected><Customers /></Protected>} />
      <Route path="/customers/:id" element={<Protected><CustomerProfile /></Protected>} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <AppProvider>
          <BrowserRouter>
            <Shell />
            <Toaster position="top-right" theme="light" richColors />
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </div>
  );
}

export default App;
