import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { useI18n } from "../i18n";

type Kind = "terms" | "privacy" | "refund";
type Section = { title: string; paragraphs: string[] };
const copy: Record<"ru" | "en", Record<Kind, Section[]>> = {
  ru: {
    terms: [
      { title: "О сервисе", paragraphs: [
        "Taxpasso помогает организовать регистрацию LLC, получение EIN и подготовку заявления на ITIN. Состав услуги, стоимость, включённые государственные сборы и дополнительные расходы должны быть указаны в вашем заказе до оплаты.",
        "Taxpasso — название сервиса. Реквизиты лица, заключающего договор с клиентом, и контакт для обращений пока не утверждены. Эта версия предназначена для предварительного ознакомления и не является окончательными условиями заказа."
      ]},
      { title: "Проверка основания ITIN", paragraphs: [
        "Опросник и первичное интервью помогают собрать сведения и определить следующий шаг. Их результат предварительный и не является решением IRS или гарантией выдачи ITIN.",
        "В текущем процессе специалист предлагает план, а администратор подтверждает его перед передачей клиенту. Затем назначается партнёр для оформления ITIN и, если входит в заказ, подготовки декларации. Административное подтверждение само по себе не подтверждает профессиональную квалификацию участника.",
        "До рабочего запуска будут уточнены полномочия участников и порядок профессиональной проверки налогового основания. Персональные налоговые и юридические заключения должны предоставляться лицами с необходимыми полномочиями в рамках согласованной услуги."
      ]},
      { title: "Оплата и состав заказа", paragraphs: [
        "Отдельный заказ ITIN оплачивается полностью после одобрения основания в установленном процессе. LLC и пакет LLC + ITIN оплачиваются полностью до начала оплачиваемых работ. Поэтапная оплата 50/50 в этих условиях не предусмотрена.",
        "В пакет LLC + ITIN входит ITIN Standard без подготовки декларации. Подготовка декларации и дополнительные услуги включаются только после отдельного согласования состава и цены.",
        "Способ оплаты и сумма сообщаются до платежа. Не отправляйте пароли, коды подтверждения или полные реквизиты банковской карты в документы заказа."
      ]},
      { title: "Документы и взаимодействие", paragraphs: [
        "Предоставляйте достоверные сведения и документы, которые вправе использовать. Проверяйте подготовленные формы перед подписанием и сообщайте об изменениях, влияющих на заказ.",
        "Если документ требует исправления, в кабинете указывается причина и доступна повторная загрузка. Предложения партнёра о документах, этапах и результатах передаются клиенту после подтверждения администратором.",
        "Необходимые согласия на подачу и подписи оформляются отдельно. Создание аккаунта само по себе не является доверенностью на представительство перед IRS."
      ]},
      { title: "Результат и сроки", paragraphs: [
        "Решения о регистрации и выдаче номеров принимают соответствующие государственные органы. Taxpasso не гарантирует одобрение, точную дату получения EIN или ITIN, открытие банковского счёта либо определённый налоговый результат.",
        "Запрос дополнительных сведений может увеличить срок. Клиенту необходимо своевременно предоставить запрошенные материалы. Отсутствие гарантии государственного решения не освобождает исполнителя от ответственности за собственные ошибки в пределах применимого права."
      ]},
      { title: "Отмена, обращения и права клиента", paragraphs: [
        "Порядок отмены и возврата описан на отдельной странице «Возвраты». Отмена заказа и перечисление возврата — разные действия.",
        "Окончательные реквизиты, контакт для претензий, применимое право и условия ответственности будут добавлены после юридической проверки. Эта предварительная версия не ограничивает права, которые нельзя исключить соглашением."
      ]}
    ],
    privacy: [
      { title: "Статус документа и оператор данных", paragraphs: [
        "Это проект описания обработки данных в Taxpasso. Наименование и адрес оператора данных, контакт для запросов и применимые основания обработки ещё должны быть утверждены перед рабочим запуском.",
        "Не загружайте реальные паспорта и налоговые документы в тестовую среду. Для проверки интерфейса используйте вымышленные данные и тестовые файлы."
      ]},
      { title: "Какие данные используются", paragraphs: [
        "В зависимости от услуги: email и данные аккаунта; имя и контактные сведения; страна проживания и гражданство; сведения о компании и её владельцах; ответы опросника; удостоверяющие личность и налоговые документы; данные заказа, подтверждения оплаты и история действий.",
        "При выборе консультации может запрашиваться контакт Telegram или WhatsApp и удобное время связи. Не предоставляйте сведения, которые не нужны для выбранной услуги."
      ]},
      { title: "Для чего нужны данные", paragraphs: [
        "Для входа в кабинет, обработки заявки, связи по заказу, проверки предоставленных материалов, подготовки согласованных форм, отображения хода работ, учёта оплаты и возвратов, а также защиты сервиса и рассмотрения обращений.",
        "Для окончательной политики будут определены правовые основания каждой цели обработки с учётом оператора, стран клиентов и фактических потоков данных. Регистрация не означает согласия на неограниченное использование данных."
      ]},
      { title: "Кто получает доступ", paragraphs: [
        "Администраторы и назначенные исполнители используют данные в рамках своих задач. Назначенным партнёрам предоставляется доступ к заказу; клиентские результаты публикуются после административного подтверждения.",
        "Инфраструктура включает Supabase для аккаунтов, базы и файлов и Vercel для размещения сайта. В выполнении услуги также могут участвовать зарегистрированный агент, профильные специалисты, государственные органы и поставщики связи или платежей.",
        "Перед рабочим запуском будет уточнён перечень получателей, их роли, страны обработки и необходимые договорные меры. Передача материалов в государственные органы должна соответствовать согласованной услуге и необходимым полномочиям."
      ]},
      { title: "Контакты, браузер и внешние сервисы", paragraphs: [
        "Браузер может сохранять данные сессии и настройки интерфейса, например выбранную тему. Окончательное описание cookies, локального хранения и аналитики будет составлено после проверки фактически подключённых инструментов.",
        "Если вы выбираете связь через Telegram или WhatsApp, обработка данных в этих сервисах также регулируется их собственными условиями. Для удостоверяющих личность и налоговых документов используйте предусмотренную загрузку в кабинет, а не обычную переписку."
      ]},
      { title: "Хранение, защита и удаление", paragraphs: [
        "Сроки хранения по категориям данных, порядок удаления и ограничения, связанные с обязательным хранением документов, ещё не утверждены. В этой версии не обещается автоматическое удаление через определённое число дней.",
        "Перед рабочим запуском будут проверены права доступа, защита административных аккаунтов, резервирование базы и файлов, восстановление и порядок реагирования на инциденты. Эта версия не заявляет, что такой аудит уже завершён.",
        "Прекращение доступа партнёра к кабинету не означает автоматического удаления копий, которые исполнитель обязан хранить по применимым правилам; это необходимо отдельно урегулировать с исполнителями."
      ]},
      { title: "Запросы о персональных данных", paragraphs: [
        "В зависимости от применимого законодательства вы можете иметь право на доступ, исправление, удаление и другие действия с данными. Некоторые сведения могут подлежать обязательному хранению.",
        "Рабочий контакт для таких запросов и порядок проверки личности заявителя будут указаны в окончательной версии. До этого документ не должен использоваться как завершённое уведомление об обработке данных для приёма реальных клиентов."
      ]}
    ],
    refund: [
      { title: "Общий порядок", paragraphs: [
        "Это проект политики. Возврат рассматривается отдельно для каждой оплаченной услуги и не может превышать фактически полученную за неё сумму. Неутверждённые условия ниже необходимо согласовать до приёма оплаты.",
        "Отмена заказа не перечисляет деньги автоматически. Решение о возврате, его сумма и фактическое перечисление фиксируются отдельно. Срок и способ перечисления должны быть сообщены при подтверждении возврата."
      ]},
      { title: "LLC + EIN", paragraphs: [
        "В текущих внутренних правилах возврат за отдельную услугу LLC + EIN ещё помечен как проект. Поэтому эта страница не обещает автоматический полный возврат и не устанавливает окончательный запрет на возвраты.",
        "Штатные сборы, стоимость выполненной работы и ещё не оказанные услуги необходимо рассматривать отдельно. Окончательные удержания и основания возврата должны быть согласованы и раскрыты до оплаты."
      ]},
      { title: "Отдельная услуга ITIN", paragraphs: [
        "Оплата производится после одобрения основания в установленном процессе. Если основание не одобрено и оплата не получена, возвращать платёж не требуется.",
        "По текущим правилам при отказе IRS следующая подача выполняется бесплатно. Повторная подача не гарантирует положительного решения IRS. Порядок действий при отсутствии допустимого основания должен быть согласован отдельно.",
        "Возврат до подачи, стоимость уже подготовленной декларации и действия при ошибках исполнителя должны быть уточнены в окончательной политике. Здесь не вводится отдельный лимит количества повторных подач."
      ]},
      { title: "Пакет LLC + ITIN", paragraphs: [
        "Пакет оплачивается полностью. Если основание ITIN не подтверждено в процессе проверки Taxpasso, предусмотрен возврат $100; оформление LLC и EIN продолжается независимо.",
        "Неподтверждённое основание при проверке Taxpasso и отказ IRS по поданному заявлению — разные события. Возврат $100 не описывается как автоматическое последствие любого отказа IRS.",
        "Возврат по ITIN сам по себе не отменяет выполненную часть LLC. При этом обязательные права клиента и ответственность за ошибки исполнителя сохраняются."
      ]},
      { title: "Отмена и факт подачи", paragraphs: [
        "В текущем процессе администратор может отменить заказ с указанием причины до зафиксированной подачи в штат или IRS. После подачи обычная отмена в интерфейсе недоступна.",
        "Это ограничение процесса не означает, что любое требование о возврате или исправлении ошибки после подачи исключено. Такие обращения рассматриваются отдельно с учётом выполненной работы, причин обращения и применимого права."
      ]},
      { title: "Дополнительные услуги и будущие периоды", paragraphs: [
        "Условия возврата по дополнительным услугам, предоплаченным будущим периодам и ещё не перечисленным государственным сборам должны быть указаны отдельно до оплаты. Они не считаются автоматически невозвратными по этой предварительной версии."
      ]},
      { title: "Как обратиться", paragraphs: [
        "Для обращения понадобятся номер заказа, описание ситуации и сведения о платеже без полных реквизитов карты. Рабочий контакт и сроки рассмотрения будут добавлены перед запуском.",
        "Эта версия не отменяет обязательные права клиента. Окончательная политика будет опубликована после согласования условий и юридической проверки."
      ]}
    ]
  },
  en: {
    terms: [
      { title: "About the service", paragraphs: [
        "Taxpasso helps coordinate LLC formation, EIN requests and ITIN applications. Your order must identify the service scope, price, included government fees and additional charges before payment.",
        "Taxpasso is the service name. The contracting operator's details and contact for enquiries have not yet been finalized. This version is for preliminary review and is not the final order agreement."
      ]},
      { title: "ITIN eligibility review", paragraphs: [
        "The quiz and initial interview collect information and suggest the next step. Their outcome is preliminary, not an IRS decision or a guarantee of an ITIN.",
        "In the current process, a specialist proposes a plan and an administrator confirms it before it reaches the client. A partner is then assigned for the ITIN application and, if included, tax return preparation. Administrative approval does not itself establish anyone's professional qualifications.",
        "Participants' authority and the professional review of the tax basis will be clarified before live launch. Individual tax and legal opinions must be provided by appropriately authorized professionals within the agreed service."
      ]},
      { title: "Payment and scope", paragraphs: [
        "Standalone ITIN orders are paid in full after the basis is approved through the established process. LLC orders and LLC + ITIN bundles are paid in full before paid work starts. These terms do not provide for 50/50 instalments.",
        "The LLC + ITIN bundle includes ITIN Standard without tax return preparation. Return preparation and additional services require a separately agreed scope and price.",
        "The payment method and amount are communicated before payment. Do not upload passwords, verification codes or full card details with order documents."
      ]},
      { title: "Documents and cooperation", paragraphs: [
        "Provide accurate information and documents you are entitled to use. Review forms before signing and report changes relevant to your order.",
        "If a document needs correction, the account shows a reason and a replacement upload option. Partner proposals about documents, stages and results reach the client after administrator approval.",
        "Required filing authorizations and signatures are obtained separately. Creating an account does not itself grant a power of attorney for IRS representation."
      ]},
      { title: "Outcomes and timing", paragraphs: [
        "Government authorities decide whether to register an entity or issue a number. Taxpasso does not guarantee approval, an exact EIN or ITIN delivery date, a bank account or a particular tax outcome.",
        "Requests for further information can extend processing time. Clients need to supply requested materials promptly. The absence of a government-outcome guarantee does not remove responsibility for the provider's own errors under applicable law."
      ]},
      { title: "Cancellation, enquiries and client rights", paragraphs: [
        "Cancellation and refunds are described on the separate Refunds page. Cancelling an order and sending a refund are separate actions.",
        "Final operator details, a complaints contact, governing law and liability terms will be added after legal review. This preliminary version does not restrict rights that cannot be excluded by agreement."
      ]}
    ],
    privacy: [
      { title: "Document status and data controller", paragraphs: [
        "This is a draft description of data processing at Taxpasso. The controller's name and address, a requests contact and applicable processing grounds must be finalized before live launch.",
        "Do not upload real passports or tax documents to a test environment. Use fictional information and test files to review the interface."
      ]},
      { title: "Information used", paragraphs: [
        "Depending on the service: email and account information; name and contact details; residence and citizenship; company and owner information; quiz answers; identity and tax documents; order details, payment confirmations and activity history.",
        "Consultations may request a Telegram or WhatsApp contact and a preferred contact time. Do not provide information unnecessary for the selected service."
      ]},
      { title: "Purposes", paragraphs: [
        "Account access, handling applications, order communications, reviewing supplied materials, preparing agreed forms, showing progress, recording payments and refunds, protecting the service and handling enquiries.",
        "The final policy will identify the legal grounds for each purpose, considering the operator, client locations and actual data flows. Registration is not consent to unrestricted use of information."
      ]},
      { title: "Access and recipients", paragraphs: [
        "Administrators and assigned providers use information for their tasks. Assigned partners receive order access; client-facing results are published after administrator approval.",
        "Infrastructure includes Supabase for accounts, the database and files, and Vercel for website hosting. Registered agents, relevant professionals, government authorities and communications or payment providers may also be involved in delivering a service.",
        "The recipient list, their roles, processing countries and required contractual safeguards will be finalized before live launch. Government submissions must follow the agreed service scope and required authorizations."
      ]},
      { title: "Communications, browser storage and external services", paragraphs: [
        "Your browser may store session information and interface preferences, such as the selected theme. The final description of cookies, local storage and analytics will follow a review of the tools actually connected.",
        "If you choose Telegram or WhatsApp communications, those services also process information under their own terms. Use the account's designated upload facility for identity and tax documents rather than ordinary messaging."
      ]},
      { title: "Retention, protection and deletion", paragraphs: [
        "Retention periods by data category, deletion procedures and mandatory recordkeeping limitations have not yet been finalized. This version does not promise automatic deletion after a fixed number of days.",
        "Access permissions, administrator account protection, database and file backups, recovery and incident procedures will be checked before live launch. This version does not claim that this audit is complete.",
        "Removing a partner's account access does not automatically delete copies that the provider must retain under applicable rules; this needs to be addressed separately with providers."
      ]},
      { title: "Personal information requests", paragraphs: [
        "Depending on applicable law, you may have rights of access, correction, deletion and other rights over your information. Some records may be subject to mandatory retention.",
        "A working requests contact and identity-verification procedure will be stated in the final version. Until then, this document must not be used as a complete privacy notice for onboarding real clients."
      ]}
    ],
    refund: [
      { title: "General approach", paragraphs: [
        "This is a draft policy. Refunds are considered separately for each paid service and cannot exceed the amount actually received for it. The unsettled terms below must be agreed before accepting payment.",
        "Cancelling an order does not automatically transfer money. The refund decision, amount and actual transfer are recorded separately. The transfer timeframe and method must be communicated when the refund is confirmed."
      ]},
      { title: "LLC + EIN", paragraphs: [
        "Current internal rules still mark refunds for standalone LLC + EIN services as a draft. This page therefore does not promise automatic full refunds or impose a final no-refund rule.",
        "State fees, completed work and services not yet delivered need separate treatment. Final deductions and refund grounds must be agreed and disclosed before payment."
      ]},
      { title: "Standalone ITIN service", paragraphs: [
        "Payment follows approval of the basis through the established process. If the basis is not approved and no payment was received, there is no payment to refund.",
        "Under current rules, the next submission after an IRS rejection is free. Resubmission does not guarantee IRS approval. The approach where no valid basis exists must be agreed separately.",
        "Pre-submission refunds, already prepared tax returns and provider errors need clarification in the final policy. This draft introduces no separate cap on the number of resubmissions."
      ]},
      { title: "LLC + ITIN bundle", paragraphs: [
        "The bundle is paid in full. If Taxpasso's review does not confirm the ITIN basis, a $100 refund is provided; LLC formation and the EIN process continue independently.",
        "An unconfirmed basis in Taxpasso's review and an IRS rejection of a filed application are different events. The $100 refund is not described as an automatic consequence of every IRS rejection.",
        "An ITIN refund does not itself undo completed LLC work. Mandatory client rights and responsibility for provider errors remain."
      ]},
      { title: "Cancellation and filing", paragraphs: [
        "In the current process, an administrator can cancel an order with a reason before a state or IRS filing has been recorded. Ordinary cancellation in the interface is unavailable after filing.",
        "This workflow restriction does not mean that every post-filing refund or error-correction request is excluded. Such requests require separate review of the work performed, the circumstances and applicable law."
      ]},
      { title: "Additional services and future periods", paragraphs: [
        "Refund terms for additional services, prepaid future periods and government fees not yet remitted must be disclosed separately before payment. This preliminary version does not automatically make them non-refundable."
      ]},
      { title: "Making a request", paragraphs: [
        "A request will need the order number, a description of the issue and payment information without full card details. A working contact and response timeframes will be added before launch.",
        "This version does not waive mandatory client rights. The final policy will be published after the terms are agreed and legally reviewed."
      ]}
    ]
  }
};

export function LegalDraft({ kind }: { kind: Kind }) {
  const { lang } = useI18n();
  const language = lang === "en" ? "en" : "ru";
  const ru = language === "ru";
  const titles = ru
    ? { terms: "Условия использования", privacy: "Конфиденциальность", refund: "Возвраты" }
    : { terms: "Terms of service", privacy: "Privacy", refund: "Refunds" };
  return (
    <article className="container page legal-page" lang={language} style={{ maxWidth: 860, overflowWrap: "anywhere" }}>
      <span className="eyebrow">TAXPASSO / LEGAL</span>
      <h1>{titles[kind]}</h1>
      <p className="notice"><Info aria-hidden="true" style={{ flexShrink: 0 }} />
        <span>{ru
          ? "Проект для предварительного ознакомления. Не вступил в силу. Юридическая проверка и реквизиты оператора ещё не завершены."
          : "Draft for preliminary review. Not effective. Legal review and operator details are not yet complete."}</span>
      </p>
      <p className="muted">{ru ? "Версия проекта: 3 октября 2026 г." : "Draft version: 3 October 2026"}</p>
      <nav aria-label={ru ? "Юридические документы" : "Legal documents"} style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px", margin: "24px 0" }}>
        {(["terms", "privacy", "refund"] as const).map(key =>
          <Link key={key} to={`/${key}`} aria-current={kind === key ? "page" : undefined}>{titles[key]}</Link>
        )}
      </nav>
      {copy[language][kind].map((section, index) => (
        <section key={section.title} aria-labelledby={`legal-${kind}-${index}`} style={{ marginTop: 32 }}>
          <h2 id={`legal-${kind}-${index}`} style={{ fontSize: "1.25rem" }}>{index + 1}. {section.title}</h2>
          {section.paragraphs.map(paragraph => <p key={paragraph} style={{ lineHeight: 1.75 }}>{paragraph}</p>)}
        </section>
      ))}
    </article>
  );
}
