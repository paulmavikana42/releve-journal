import { redirect } from "next/navigation";

export default function Home() {
  // Le middleware renvoie vers /login si la session manque.
  redirect("/journal");
}
