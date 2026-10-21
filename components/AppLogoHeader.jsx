'use client';

import Image from 'next/image';

export default function AppHeader() {
  return (
    <header className="w-full bg-transparent px-4 py-6">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4">
        <div className="grid w-full max-w-3xl grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex justify-end">
            <div className="flex h-16 w-16 items-center justify-center rounded-full sm:h-20 sm:w-20">
              <Image
                src="/clarinLogo.png"
                alt="Clarin Logo"
                width={72}
                height={72}
                className="h-auto w-[52px] object-contain sm:w-[64px]"
                priority
              />
            </div>
          </div>

          <div className="flex flex-col items-center justify-center px-2 text-center">
            <h1 className="text-3xl font-extrabold tracking-[0.15em] text-emerald-700 sm:text-4xl">
              LUWAS
            </h1>
          </div>

          <div className="flex justify-start">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm sm:h-20 sm:w-20">
              <Image
                src="/mdrrmcLogo.png"
                alt="MDRRMC Logo"
                width={72}
                height={72}
                className="h-auto w-[52px] object-contain sm:w-[64px]"
                priority
              />
            </div>
          </div>
        </div>

        <div className="max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 sm:text-base">
            LGU Unified Web-based Alert System
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base md:text-lg">
            Risk Mapping and Accident Reporting for safer, data-driven local disaster response.
          </p>
        </div>
      </div>
    </header>
  );
}
