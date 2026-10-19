// Small shared building blocks. Keep these plain: one job each.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { avatarColor, initials } from '../lib/format'

export function Logo({ size = 28 }: { size?: number }) {
  return <img src="/logo.svg" width={size} height={size} alt="" className="shrink-0" />
}

export function Avatar({ name, size = 34, accountColor }: { name: string; size?: number; accountColor?: string }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-full font-bold text-[#0e0f12]"
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials(name)}
      {accountColor && (
        <i className="absolute -right-px -bottom-px h-2.5 w-2.5 rounded-full border-2 border-panel" style={{ background: accountColor }} />
      )}
    </span>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }

const buttonStyles = {
  primary: 'bg-accent text-accent-ink font-semibold hover:brightness-105',
  secondary: 'bg-raise text-ink border border-line hover:bg-hover',
  ghost: 'text-ink-2 hover:bg-raise',
  danger: 'text-danger border border-line hover:bg-raise',
}

export function Button({ variant = 'secondary', className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-[13.5px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
      {...props}
    />
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line px-1.5 font-sans text-[11px] font-semibold text-muted">{children}</kbd>
}

export function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      {children}
    </span>
  )
}

export function Card({ title, description, children, actions }: { title: string; description?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel">
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {actions}
      </header>
      {children && <div className="px-5 py-4">{children}</div>}
    </section>
  )
}
