import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import Home from "./pages/Home";
import Workflows from "./pages/Workflows";
import WorkflowDetail from "./pages/WorkflowDetail";
import Executions from "./pages/Executions";
import Insights, { ErrorsInsights } from "./pages/Insights";
import Monitoring from "./pages/Monitoring";
import Settings from "./pages/Settings";
import Users from "./pages/Users";
import Audit from "./pages/Audit";
import WorkspaceSecurity from "./pages/WorkspaceSecurity";

function ErrorsPage() { return <ErrorsInsights />; }

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!loading && user && user.role !== "admin") setLocation("/");
  }, [loading, user, setLocation]);
  if (loading) return null;
  if (!user) return <div>{children}</div>;
  if (user.role !== "admin") return null;
  return <>{children}</>;
}

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/workflows" component={Workflows} />
    <Route path="/workflows/:id" component={WorkflowDetail} />
    <Route path="/executions" component={Executions} />
    <Route path="/errors" component={ErrorsPage} />
    <Route path="/analytics" component={Insights} />
    <Route path="/monitoring" component={Monitoring} />
    <Route path="/workspace-security" component={WorkspaceSecurity} />
    <Route path="/settings">{() => <AdminOnly><Settings /></AdminOnly>}</Route>
    <Route path="/users">{() => <AdminOnly><Users /></AdminOnly>}</Route>
    <Route path="/audit">{() => <AdminOnly><Audit /></AdminOnly>}</Route>
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light" switchable><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
