// Change the shared language preference in place so open forms keep their draft state.
import { Languages } from "lucide-react";
import { setLanguage, tr } from "../i18n";
import { useLanguage } from "../useLanguage";

export default function LanguageSwitch() {
  const language = useLanguage();
  return <button type="button" className="language-switch secondary"
    title={tr("Switch language")} aria-label={tr("Switch language")}
    onClick={() => setLanguage(language === "en" ? "zh" : "en")}>
    <Languages size={17} aria-hidden="true" />
    <span lang={language === "en" ? "zh-CN" : "en"}>{language === "en" ? "中文" : "English"}</span>
  </button>;
}
