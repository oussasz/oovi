import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Slime } from "@/components/Slime";

export default function NotFound() {
  return (
    <>
      <SiteNav />
      <main className="container page" style={{ textAlign: "center", display: "grid", justifyItems: "center", gap: 18 }}>
        <Slime color="lilac" shape="drop" face="oh" size={140} />
        <h1 className="h2">Hmm, nothing here.</h1>
        <p className="lead small">This page wandered off. Let’s get you back home.</p>
        <Link href="/" className="btn btn-dark btn-md">Back to home</Link>
      </main>
      <SiteFooter />
    </>
  );
}
