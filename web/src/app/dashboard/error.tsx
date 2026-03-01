"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <div className="max-w-md w-full text-center">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.268 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Error en el panel
        </h2>
        <p className="text-gray-600 mb-6">
          Se ha producido un error al cargar esta seccion. Puedes intentar de
          nuevo o volver al inicio del panel.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-[#307177] hover:bg-[#265a5f] transition-colors"
          >
            Intentar de nuevo
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-[#307177] bg-white border border-[#307177] hover:bg-gray-50 transition-colors"
          >
            Volver al panel
          </button>
        </div>
      </div>
    </div>
  );
}
