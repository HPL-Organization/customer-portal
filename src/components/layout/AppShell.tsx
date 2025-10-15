import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
        <AppSidebar />
        <div className="flex min-h-screen flex-col">
          {/* <AppHeader /> */}
          <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
