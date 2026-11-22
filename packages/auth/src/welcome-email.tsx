/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@rakazo/adapter-kit";
import { ANDROID_APK_URL } from "@rakazo/contracts";
import { Link, Text } from "react-email";
import { emailText, greeting, linkStyle, message, withNodes } from "./email.js";

// Manor: every app download lives on Manor's releases page.
const MANOR_RELEASES_URL = ANDROID_APK_URL;
const APPS = ["iPhone", "Android", "Mac", "Windows", "Linux"];

const stepStyle = { margin: "20px 0 4px" };

// Manor: upstream's community, GitHub star, signature and hosted header image are left out; the
// welcome email says Manor and links only to Manor's releases page.
export function welcomeEmail(
  user: { email: string; name: string },
  unsubscribeUrl: string,
  locale = "en",
): Promise<TransactionalEmail> {
  const say = emailText(locale);
  return message(
    user.email,
    locale,
    say("Welcome to Rakazo"),
    <>
      <Text>{greeting(say, user.name)}</Text>
      <Text style={stepStyle}>
        <strong>{say("Get the apps")}</strong>
      </Text>
      <Text style={{ marginTop: 0 }}>
        {withNodes(
          say("Rakazo runs on {platforms}, so your bots can reach you wherever you are."),
          {
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
          },
        )}
      </Text>
    </>,
    unsubscribeUrl,
  );
}
