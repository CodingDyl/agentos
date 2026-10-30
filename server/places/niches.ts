/**
 * The high-ticket niches the Find tab can search for.
 *
 * Static on purpose: the dropdown, the Places text query and the advertising
 * caveat all come from one place, so a niche cannot be offered without its
 * warning. `query` is what Google Places is asked for, written the way a
 * customer would type it.
 */

import type { PlaceNiche } from "../../shared/places-types";

export type { PlaceNiche };

export const NICHES: readonly PlaceNiche[] = [
  {
    id: "dentists",
    label: "Dentists and orthodontists",
    query: "dentist",
    why: "High lifetime value per patient, and many practices run old sites.",
    caveat: "Many belong to group chains with a head-office website. Check the owner is local.",
  },
  {
    id: "law_firms",
    label: "Law firms",
    query: "attorneys law firm",
    why: "Referral-heavy practices with many dated sites.",
    caveat: "The Legal Practice Council limits advertising claims, so pitch a credible site, not “more clients”.",
  },
  {
    id: "cosmetic_surgeons",
    label: "Cosmetic and plastic surgeons",
    query: "plastic surgeon",
    why: "Very high ticket, and patients judge the practice by its site.",
    caveat: "Health-professional advertising rules apply to the site you build.",
  },
  {
    id: "architects",
    label: "Architects",
    query: "architect",
    why: "The site is the portfolio.",
    caveat: "Often already well designed. Expect fewer weak sites.",
  },
  {
    id: "solar_installers",
    label: "Solar installers",
    query: "solar panel installer",
    why: "High-ticket jobs that start with a Google search.",
    caveat: "Cheap template-site competition, so price sensitivity is high.",
  },
  {
    id: "financial_advisers",
    label: "Financial advisers and wealth managers",
    query: "financial adviser",
    why: "High client value, and trust is built on the site.",
    caveat: "Regulated by the FSCA, so the claims on the site must be compliant.",
  },
  {
    id: "private_clinics",
    label: "Private specialists and clinics",
    query: "specialist doctor clinic",
    why: "High value per patient.",
    caveat: "A practice manager often gatekeeps the decision.",
  },
  {
    id: "guesthouses",
    label: "Guesthouses and holiday rentals",
    query: "guest house",
    why: "Photos sell the booking, and a weak photo set costs them guests every week.",
    caveat: "Use their photos only as a private sample sent to the owner, never published, and do not take photos from Airbnb or booking sites.",
  },
  {
    id: "restaurants",
    label: "Restaurants",
    query: "restaurant",
    why: "Photos sell the booking, since diners choose by what the food and room look like.",
    caveat: "Use their photos only as a private sample sent to the owner, never published, and do not take photos from Airbnb or booking sites.",
  },
  {
    id: "estate_agents",
    label: "Estate agents",
    query: "estate agent",
    why: "Photos sell the viewing, and listings with weak photos get skipped.",
    caveat: "Use their photos only as a private sample sent to the owner, never published, and do not take photos from Airbnb or booking sites.",
  },
  {
    id: "venues",
    label: "Wedding and golf venues",
    query: "wedding venue",
    why: "Photos sell the booking, because couples and golfers decide on what they see first.",
    caveat: "Use their photos only as a private sample sent to the owner, never published, and do not take photos from Airbnb or booking sites.",
  },
];

export function nicheById(id: string): PlaceNiche | undefined {
  return NICHES.find((niche) => niche.id === id);
}
