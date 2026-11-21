/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@rakazo/adapter-kit";
import { ANDROID_APK_URL } from "@rakazo/contracts";
import { Link, Text } from "react-email";
import { emailText, greeting, linkStyle, message } from "./email.js";

// Manor: every app download lives on Manor's releases page.
const MANOR_RELEASES_URL = ANDROID_APK_URL;
const APPS = ["iPhone", "Android", "Mac", "Windows", "Linux"];

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
      <Text>{say("Thanks for signing up for Rakazo.")}</Text>
      <Text>
        {say("Rakazo also has apps for")}{" "}
        {/* The language's own list ("A, B, and C", "A, B y C"), with each app a link. */}
        {new Intl.ListFormat(locale, { type: "conjunction" })
          .formatToParts(APPS)
          .map((part, index) =>
            part.type === "element" ? (
              <Link key={part.value} href={MANOR_RELEASES_URL} style={linkStyle}>
                {part.value}
              </Link>
            ) : (
              <span key={`${index}${part.value}`}>{part.value}</span>
            ),
          )}
        .
      </Text>
      <Text>{say("Have any questions? Reply to this email.")}</Text>
    </>,
    unsubscribeUrl,
  );
}
