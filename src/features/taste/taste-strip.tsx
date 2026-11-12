import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { HairlineCard, Section } from "@/components/os";
import { useTaste } from "@/lib/agentos/taste";

/**
 * The Taste Vault references attached to one workspace, on its Creative tab.
 * With none attached it is a single line and a link, never an empty panel.
 */
export function TasteStrip({ slug }: { slug: string }) {
  const { data } = useTaste(slug);
  const vault = `/taste?workspace=${encodeURIComponent(slug)}`;
  const link = "os-focus-ring rounded-sm text-foreground underline decoration-os-border-strong underline-offset-4 hover:decoration-foreground";

  // Still loading or unreadable: the tab's own content is what matters here.
  if (!data) return null;

  if (data.length === 0) {
    return (
      <p className="os-meta text-os-subtle">
        No taste references are attached to this workspace.{" "}
        <Link to={vault} className={link}>
          Attach some in Taste Vault
        </Link>
      </p>
    );
  }

  return (
    <Section
      label="Taste references"
      action={
        <Link to={vault} className="os-focus-ring os-meta inline-flex items-center gap-1.5 rounded-sm text-os-muted transition-colors duration-150 hover:text-foreground">
          Open in Taste Vault
          <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        </Link>
      }
    >
      <HairlineCard className="p-3">
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {data.map((asset) => (
            <li key={asset.id} className="aspect-square overflow-hidden rounded-md bg-os-surface-raised">
              <img src={asset.thumbnailUrl} alt={asset.notes ? `${asset.filename}: ${asset.notes}` : asset.filename} loading="lazy" className="size-full object-cover" />
            </li>
          ))}
        </ul>
      </HairlineCard>
      <p className="os-meta mt-3 text-os-subtle">Claude is shown these before design work in this workspace.</p>
    </Section>
  );
}
