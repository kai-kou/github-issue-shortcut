import { useLanguage } from "../i18n/LanguageContext";
import LegalPage from "./LegalPage";

function PrivacyPolicy() {
  const { t } = useLanguage();
  return <LegalPage {...t.privacy} />;
}

export default PrivacyPolicy;
