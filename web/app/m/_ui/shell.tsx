// Shared by the phone app's layout (/m) and the web version's (/app).
import { Tajawal } from "next/font/google";

// Nunito (the website's font) has no Arabic letters: Tajawal is its rounded, friendly match for Arabic.
export const arabic = Tajawal({ subsets: ["arabic"], weight: ["400", "500", "700", "800"], variable: "--font-ar", display: "swap" });

// Before the first paint: the phone's saved language and look, so Arabic opens right-to-left at once.
export const PREPAINT = `try{var p=JSON.parse(localStorage.getItem("oovi.m.prefs")||"{}");var l=p.lang&&p.lang!=="auto"?p.lang:null;if(!l){var n=(navigator.languages||[navigator.language]);for(var i=0;i<n.length;i++){var c=String(n[i]).slice(0,2).toLowerCase();if(c==="ar"||c==="fr"||c==="en"){l=c;break}}}l=l||"en";var h=document.documentElement;h.lang=l;h.dir=l==="ar"?"rtl":"ltr";h.dataset.mtheme=p.theme||"auto";h.classList.add("m-root")}catch(e){}`;
