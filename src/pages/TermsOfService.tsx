import { useLanguage } from "../i18n/LanguageContext";
import LegalPage from "./LegalPage";

function TermsOfService() {
  const { t } = useLanguage();
  return <LegalPage {...t.terms} />;
}

export default TermsOfService;
