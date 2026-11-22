/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@rakazo/adapter-kit";
import { ANDROID_APK_URL } from "@rakazo/contracts";
import { Link, Text } from "react-email";
import { emailText, greeting, linkStyle, message, withNodes } from "./email.js";
import { emailCopy } from "./email-copy/deployment-copy.js";

// Manor: every app download lives on Manor's releases page.
const MANOR_RELEASES_URL = ANDROID_APK_URL;
const APPS = ["iPhone", "Android", "Mac", "Windows", "Linux"];

const stepStyle = { margin: "20px 0 4px" };

// Manor: upstream's community and GitHub star steps and hosted header image are left out; the
// welcome email links only to Manor's releases page. Its wording is the deployment's copy.
export function welcomeEmail(
  user: { email: string; name: string },
  unsubscribeUrl: string,
  locale = "en",
): Promise<TransactionalEmail> {
  const say = emailText(locale);
  const copy = emailCopy("welcome", locale);
  return message(
    user.email,
    locale,
    copy("subject"),
    <>
      <Text>{greeting(say, user.name)}</Text>
      <Text>{copy("intro")}</Text>
      <Text style={stepStyle}>
        <strong>{copy("appsTitle")}</strong>
      </Text>
      <Text style={{ marginTop: 0 }}>
        {withNodes(copy("apps"), {
          // The language's own list ("A, B, and C", "A, B y C"), with each app a link.
          platforms: new Intl.ListFormat(locale, { type: "conjunction" })
            .formatToParts(APPS)
            .map((part, index) =>
              part.type === "element" ? (
                <Link key={part.value} href={MANOR_RELEASES_URL} style={linkStyle}>
                  {part.value}
                </Link>
              ) : (
                <span key={`${index}${part.value}`}>{part.value}</span>
              ),
            ),
        })}
      </Text>
      <Text style={{ marginTop: "28px" }}>{copy("closing")}</Text>
      <Text>{copy("signature")}</Text>
    </>,
    unsubscribeUrl,
  );
}
