import { fetchHomepage } from "@/lib/contentstack";

export default async function HomePage() {
  const entry = await fetchHomepage<{ title?: string }>();

  return (
    <main>
      <h1>{entry?.title ?? "Homepage"}</h1>
    </main>
  );
}
