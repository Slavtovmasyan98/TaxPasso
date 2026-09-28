# Тексты шага оплаты (RU / EN)

Единый источник текстов для `src/i18n/ru.ts` и `en.ts`. Тон: деловой, точный, без обещаний, которых система не гарантирует.
Числа подставляются из ответа `order_payment_due` и таблиц цен, а не пишутся в тексте вручную.

## Срок обслуживания

| Ключ | RU | EN |
|---|---|---|
| `term.title` | Срок обслуживания | Service term |
| `term.y1` | 1 год — включён в стоимость пакета | 1 year — included in the package |
| `term.y2` / `term.y3` | 2 года / 3 года | 2 years / 3 years |
| `term.help` | Обслуживание включает услуги Registered Agent и сопровождение компании. Первый год входит в стоимость пакета; последующие годы оплачиваются заранее, при оформлении заказа. | Service includes Registered Agent and ongoing company support. The first year is included in the package; later years are paid in advance at checkout. |

## Профиль компании

| Ключ | RU | EN |
|---|---|---|
| `profile.owners` | Количество участников LLC | Number of LLC members |
| `profile.owners1` / `owners2` | Один участник / Два и более участников | One member / Two or more members |
| `profile.purpose` | Для чего вам нужна компания? (необязательно) | What will the company be used for? (optional) |
| `profile.bank` | Открытие банковского счёта | Opening a bank account |
| `profile.pay` | Приём платежей (Stripe, PayPal) | Accepting payments (Stripe, PayPal) |
| `profile.mkt` | Продажи на маркетплейсах | Selling on marketplaces |
| `profile.none` | Только регистрация компании | Company registration only |

## Дополнительные услуги

| Ключ | RU | EN |
|---|---|---|
| `addon.default_note` | Дополнительные услуги не выбраны по умолчанию. | Optional services are not selected by default. |
| `addon.recommended` | Рекомендуем | Recommended |
| `f5472.title` | Form 5472 и pro-forma 1120: ежегодная отчётность в IRS | Form 5472 and pro-forma 1120: annual IRS reporting |
| `f5472.reason` | В компании один участник. | The company has a single member. |
| `f5472.body` | Если единственный участник LLC не является налоговым резидентом США, компания обязана ежегодно подавать эту отчётность в IRS, как правило, до 15 апреля. За непредставление формы предусмотрен штраф в размере $25 000. Мы подготовим и подадим документы. | If the sole member of the LLC is not a US tax resident, the company must file this report with the IRS every year, generally by April 15. The penalty for failing to file is $25,000 per form. We prepare and file the documents. |
| `f5472.disclaimer` | Информация носит справочный характер и не является налоговой консультацией. Применимость услуги подтверждает специалист. | This information is for reference only and is not tax advice. A specialist confirms whether the service applies to you. |
| `f5472.unavailable` | Услуга недоступна для LLC с несколькими участниками: для таких компаний применяется иная отчётность (Form 1065). Свяжитесь с нами, чтобы получить индивидуальное предложение. | Not available for LLCs with several members: a different return (Form 1065) applies. Contact us for a tailored proposal. |
| `addr.title` | Почтовый адрес в США | US mailing address |
| `addr.reason` | Вы планируете банк, платёжную систему или маркетплейс. | You plan to use a bank, a payment provider or a marketplace. |
| `addr.body_recommended` | Банки, платёжные системы и маркетплейсы, как правило, запрашивают действующий адрес компании в США. Адрес регистрационного агента для этих целей обычно не принимается. | Banks, payment providers and marketplaces generally ask for a working US business address. A registered agent's address is usually not accepted for this purpose. |
| `addr.body_default` | Понадобится, если вы планируете открыть банковский счёт, подключить платёжную систему или получать деловую корреспонденцию. Адрес регистрационного агента для этих целей обычно не принимается. | Needed if you plan to open a bank account, connect a payment provider or receive business mail. A registered agent's address is usually not accepted for this purpose. |
| `addon.price_line` | {price} в год × {years} = {total} | {price} per year × {years} = {total} |

## Сводка «К оплате сейчас»

| Ключ | RU | EN |
|---|---|---|
| `sum.title` | К оплате сейчас | Due now |
| `sum.package` | LLC {state} и EIN — регистрация | LLC {state} and EIN — formation |
| `sum.package_sub` | Государственная пошлина за регистрацию, услуги Registered Agent на первый год, получение EIN, комплект учредительных документов. | State filing fee, Registered Agent for the first year, EIN, and the formation document set. |
| `sum.renewal` | Обслуживание: {period} | Service: {period} |
| `sum.renewal_sub` | Registered Agent и сопровождение · {price} × {n} | Registered Agent and support · {price} × {n} |
| `sum.period2` / `period23` | второй год / второй и третий годы | year 2 / years 2 and 3 |
| `sum.statefee` | Государственный сбор штата: {period} | State fee: {period} |
| `sum.statefee_tag` | оплачивается штату | paid to the state |
| `sum.statefee_wy` | Ежегодный отчёт штата Wyoming — от $60 в год, срок — месяц регистрации компании. Сбор оплачивается штату от вашего имени. | Wyoming annual report — from $60 per year, due in the company's formation month. The fee is paid to the state on your behalf. |
| `sum.statefee_de` | Ежегодный налог штата Delaware — $400 в год, срок оплаты — 1 июня. Налог оплачивается штату от вашего имени. | Delaware annual tax — $400 per year, due June 1. The tax is paid to the state on your behalf. |
| `sum.total` | Итого | Total |
| `sum.split` | В том числе государственные сборы: {gov} · услуги Taxpasso: {ours} | Of which government fees: {gov} · Taxpasso services: {ours} |
| `sum.firstyear` | В первый год государственные сборы штата оплачивать не требуется. | No state fees are payable in the first year. |
| `sum.footnote` | Государственные ставки могут изменяться. Налоги на доход, пересылка документов и прочие индивидуальные расходы в стоимость не включены. | Government rates may change. Income taxes, document shipping and other individual costs are not included. |
| `sum.cta` | Перейти к оплате | Continue to payment |

## Страница /pricing

| Ключ | RU | EN |
|---|---|---|
| `pricing.f5472` | Form 5472 + pro-forma 1120 — $349 в год. Оформляется по запросу. | Form 5472 + pro-forma 1120 — $349 per year. Available on request. |
| `pricing.address` | Почтовый адрес в США — по запросу | US mailing address — on request |
| `pricing.de_expedite` | Ускоренная регистрация Delaware — по запросу | Expedited Delaware filing — on request |
| `pricing.disclaimer` | Расчёт ориентировочный. Итоговая стоимость подтверждается перед оплатой. | The calculation is an estimate. The final price is confirmed before payment. |

## Сообщения об ошибках

| Код базы | RU | EN |
|---|---|---|
| `Invalid service term` | Выберите срок обслуживания от 1 до 3 лет. | Choose a service term of 1 to 3 years. |
| `Order already paid` | Заказ уже оплачен, срок изменить нельзя. Для продления свяжитесь с нами. | This order is already paid and the term can't be changed. Contact us to renew. |
| `Not available for this order` | Для этого продукта срок обслуживания не выбирается. | A service term isn't available for this product. |
| `Amount required` | Укажите полученную сумму. Расчётная сумма: {expected}. | Enter the amount received. Expected amount: {expected}. |
| `Amount mismatch` | Сумма не совпадает с расчётной. Ожидается {expected}. | The amount doesn't match. Expected {expected}. |
