import Image from "next/image";

/**
 * The StudyFlow mark, shown beside the wordmark in the sidebar and mobile header.
 *
 * The source artwork is a square with the rounded corners baked in against black, so it's clipped
 * with a matching `rounded-*` container — otherwise the black corners show against the app's light
 * surfaces. The same file is the favicon and Apple touch icon (`src/app/icon.jpg`,
 * `src/app/apple-icon.jpg`), which Next.js picks up by filename convention.
 */
export function Logo({ className = "h-7 w-7 rounded-lg" }: { className?: string }) {
  return (
    <span className={`inline-block shrink-0 overflow-hidden ${className}`}>
      <Image src="/logo.jpg" alt="" width={64} height={64} className="h-full w-full object-cover" priority />
    </span>
  );
}
