const STATUS = {
  new: 'Новая заявка', contacted: 'Связываемся с вами', scheduled: 'Визит назначен',
  diagnostics: 'Диагностика', awaiting_approval: 'Ждём согласования',
  in_progress: 'В работе', ready: 'Готов к выдаче', completed: 'Завершён', cancelled: 'Отменён'
};
const TRANSITIONS = {new:['contacted','scheduled','cancelled'],contacted:['scheduled','diagnostics','cancelled'],scheduled:['diagnostics','cancelled'],diagnostics:['awaiting_approval','cancelled'],awaiting_approval:['in_progress','diagnostics','cancelled'],in_progress:['ready','diagnostics'],ready:['completed','in_progress'],completed:[],cancelled:[]};
const SERVICE = { engine: 'Двигатель', transmission: 'АКПП', maintenance: 'Техническое обслуживание', diagnostics: 'Диагностика', suspension: 'Подвеска', brakes: 'Тормозная система', electrical: 'Электрика', climate: 'Кондиционер' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => `${new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0}).format(Number(value) || 0)} ₽`;
const date = value => value && !Number.isNaN(new Date(value).getTime()) ? new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : 'Не назначено';
const label = value => STATUS[value] || value || '—';
const service = value => SERVICE[value] || value || 'Обращение в сервис';
const orderLabel = order => order.status === 'awaiting_approval' && order.quote?.status === 'approved' ? 'Смета согласована' : label(order.status);
const closed = order => ['completed', 'cancelled'].includes(order.status);
const icon = '<span aria-hidden="true"><svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg></span>';
async function api(path, method = 'GET', data) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: data ? {'Content-Type': 'application/json'} : {}, ...(data ? {body: JSON.stringify(data)} : {}) });
  let result;
  try { result = await response.json(); } catch { throw new Error('Сервис временно недоступен. Попробуйте ещё раз.'); }
  if (!response.ok) { const error = new Error(typeof result.error === 'string' ? result.error : result.error?.message || result.message || 'Не удалось выполнить действие.'); error.status = response.status; throw error; }
  return result;
}
function localDate(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

export async function renderPortal(path, mount) {
  const admin = path.startsWith('/admin');
  const state = { user: null, data: null, selected: null, auth: 'login', filter: 'active', search: '', notice: '', error: '', addingCar: false, booking: false, hasUpdates: false };
  mount.innerHTML = '<section class="portal"><div class="portal-loading" role="status">Открываем кабинет…</div></section>';
  let portalRoot = mount.firstElementChild;
  let pollTimer = null, pollBusy = false, snapshot = '';
  function startPolling() {
    if (pollTimer || !state.data || !state.user) return;
    pollTimer = setInterval(async () => {
      if (!portalRoot?.isConnected || !state.user) { clearInterval(pollTimer); pollTimer = null; return; }
      if (document.hidden || pollBusy) return;
      pollBusy = true;
      try {
        const current = await api(admin ? '/api/admin' : '/api/account');
        if (portalRoot?.isConnected && JSON.stringify(current) !== snapshot) {
          state.hasUpdates = true;
          const notice = mount.querySelector('[data-updates]');
          if (notice) notice.hidden = false;
        }
      } catch { /* Quiet check: the explicit refresh action reports connection errors. */ }
      finally { pollBusy = false; }
    }, 30000);
  }
  function captureDrafts() {
    return Array.from(mount.querySelectorAll('form[data-dirty="true"]')).filter(f=>f.dataset.form!=='auth').map(form=>({
      kind:form.dataset.form,id:form.dataset.id||'',quote:form.dataset.quote||'',open:form.closest('details')?.open,
      rows:form.dataset.form==='quote'?Array.from(form.querySelectorAll('.portal-quote-row')).map(row=>({title:row.querySelector('[name="itemTitle"]').value,quantity:row.querySelector('[name="itemQuantity"]').value,unitPrice:row.querySelector('[name="itemPrice"]').value})):null,
      controls:Array.from(form.querySelectorAll('input,select,textarea')).map(el=>({name:el.name,type:el.type,value:el.value,checked:el.checked}))
    }));
  }
  function restoreDrafts(drafts) {
    for(const draft of drafts) {
      const form=Array.from(mount.querySelectorAll('form[data-form]')).find(f=>f.dataset.form===draft.kind&&(f.dataset.id||'')===draft.id&&(f.dataset.quote||'')===draft.quote);
      if(!form)continue;
      if(draft.rows)form.querySelector('.portal-quote-editor').innerHTML=draft.rows.map(quoteRow).join('');
      const controls=Array.from(form.querySelectorAll('input,select,textarea'));
      draft.controls.forEach((saved,i)=>{const el=controls[i];if(!el||el.name!==saved.name||el.type!==saved.type)return;el.value=saved.value;if(el.type==='checkbox'||el.type==='radio')el.checked=saved.checked;});
      form.dataset.dirty='true';
      if(form.closest('details')&&draft.open)form.closest('details').open=true;
      if(draft.rows)updateQuoteTotal(form);
    }
  }
  async function refreshPreservingDrafts() { const drafts=captureDrafts(); await reload(); restoreDrafts(drafts); }
  function notify(message, error = false) { state[error ? 'error' : 'notice'] = message; draw(); mount.querySelector('.portal-alert')?.focus(); }
  async function reload() {
    const result = await api('/api/auth/me'); state.user = result.user;
    if (state.user && (!admin || state.user.role === 'admin')) state.data = await api(admin ? '/api/admin' : '/api/account');
    else state.data = null;
    state.hasUpdates = false;
    snapshot = state.data ? JSON.stringify(state.data) : '';
    draw();
    startPolling();
  }
  function flash() { return `${state.error ? `<div class="portal-alert is-error" role="alert" tabindex="-1">${esc(state.error)}<button type="button" data-dismiss="error" aria-label="Закрыть сообщение">×</button></div>` : ''}${state.notice ? `<div class="portal-alert" role="status" tabindex="-1">${esc(state.notice)}<button type="button" data-dismiss="notice" aria-label="Закрыть сообщение">×</button></div>` : ''}`; }
  function authView() {
    const register = !admin && state.auth === 'register';
    return `<div class="portal-auth-layout"><div class="portal-intro"><p class="portal-eyebrow">STERNOIR / ${admin ? 'Управление сервисом' : 'Личный кабинет'}</p><h1>${admin ? 'Весь сервис.<br>Под контролем.' : 'Ваш Mercedes.<br>Всё по делу.'}</h1><p>${admin ? 'Обращения, запись на ремонт и согласования в одном рабочем пространстве.' : 'Записывайтесь в сервис, согласовывайте стоимость и следите за ремонтом без лишних звонков.'}</p><ol class="portal-benefits"><li><span>01</span>${admin ? 'Новые обращения не теряются' : 'Автомобили и история обращений'}</li><li><span>02</span>${admin ? 'Смета и статус по каждому заказу' : 'Понятная смета до начала работ'}</li><li><span>03</span>${admin ? 'Переписка рядом с заказом' : 'Прямой диалог с сервисом'}</li></ol><div class="portal-auth-photo"><img src="/assets/e-w212-facelift-front.webp" alt="Mercedes-Benz E-Класса" loading="lazy" width="1200" height="750"></div><a class="portal-text-link" href="/">На главную ${icon}</a></div><div class="portal-auth-card">${!admin ? `<div class="portal-tabs" aria-label="Вход или регистрация"><button type="button" data-auth="login" class="${!register ? 'is-active' : ''}" aria-pressed="${!register}">Войти</button><button type="button" data-auth="register" class="${register ? 'is-active' : ''}" aria-pressed="${register}">Создать кабинет</button></div>` : '<p class="portal-eyebrow">Доступ для команды</p>'}<h2>${register ? 'Будем знакомы' : 'С возвращением'}</h2>${flash()}<form data-form="auth">${register ? '<label>Как к вам обращаться<input name="name" autocomplete="name" minlength="2" maxlength="100" required placeholder="Ваше имя"></label><label>Телефон<input name="phone" autocomplete="tel" type="tel" maxlength="30" placeholder="+7 …"></label>' : ''}<label>Электронная почта<input name="email" autocomplete="email" type="email" maxlength="254" required placeholder="name@example.ru"></label><label>Пароль<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="${register ? '10' : '1'}" maxlength="128" required ${register ? 'aria-describedby="password-help"' : ''}></label>${register ? '<p id="password-help" class="portal-hint">Не менее 10 символов. Используйте уникальный пароль.</p><label class="portal-check"><input type="checkbox" name="consent" required><span>Принимаю <a href="/privacy" target="_blank" rel="noopener">условия обработки персональных данных</a>.</span></label>' : ''}<button class="portal-button" type="submit">${register ? 'Создать кабинет' : 'Войти'} ${icon}</button></form><p class="portal-hint">${admin ? 'Вход доступен только сотрудникам с правами администратора.' : 'Если записывались без входа, попросите сервис связать обращение с вашим кабинетом.'}</p></div></div>`;
  }
  function orderCard(order) {
    return `<button class="portal-order ${String(state.selected) === String(order.id) ? 'is-selected' : ''}" data-order="${esc(order.id)}" aria-pressed="${String(state.selected) === String(order.id)}"><span class="portal-order-top"><span class="portal-order-number">${esc(order.publicId || `№ ${order.id}`)}</span><span class="portal-status status-${esc(order.status)}">${esc(orderLabel(order))}</span></span><strong>${esc(order.model || 'Mercedes-Benz')}</strong><span>${esc(service(order.service))}</span><span class="portal-order-bottom"><span>${esc(admin ? order.name : date(order.createdAt))}</span><span>${order.quote ? money(order.quote.total) : 'Смета впереди'}</span></span></button>`;
  }
  function quoteView(order) {
    const q = order.quote;
    if (!q) return `<section class="portal-section"><div class="portal-section-heading"><h3>Смета</h3></div><p class="portal-muted">${admin ? 'После диагностики добавьте работы и запчасти. Клиент увидит каждую позицию и итог.' : 'После диагностики здесь появятся работы, запчасти и итоговая стоимость для согласования.'}</p></section>`;
    const approved = q.status === 'approved' || Boolean(q.approvedAt);
    const pending = q.status === 'pending';
    return `<section class="portal-section"><div class="portal-section-heading"><h3>Смета <span class="portal-muted">${q.version ? ` / ${esc(q.version)}` : ''}</span></h3><span class="portal-status ${approved ? 'status-ready' : 'status-awaiting_approval'}">${approved ? 'Согласована' : q.status === 'rejected' ? 'Требует пересмотра' : q.status === 'superseded' ? 'Заменена новой' : 'На согласовании'}</span></div><div class="portal-table-wrap"><table class="portal-quote"><thead><tr><th scope="col">Работа / запчасть</th><th scope="col">Кол-во</th><th scope="col">Цена</th><th scope="col">Сумма</th></tr></thead><tbody>${(q.items || []).map(item => `<tr><td>${esc(item.title)}</td><td>${esc(item.quantity)}</td><td>${money(item.unitPrice)}</td><td>${money(Number(item.quantity)*Number(item.unitPrice))}</td></tr>`).join('')}</tbody></table></div>${q.note ? `<p class="portal-hint">${esc(q.note)}</p>` : ''}<div class="portal-total"><span>Итого по смете</span><strong>${money(q.total)}</strong></div>${approved ? `<p class="portal-hint">Согласовано ${esc(date(q.approvedAt))}. Изменение объёма работ требует нового согласования.</p>` : !admin && pending && !closed(order) ? `<form data-form="approve" data-id="${esc(order.id)}" data-quote="${esc(q.id)}"><label class="portal-check"><input type="checkbox" required><span>Проверил состав сметы и согласен на работы на сумму ${money(q.total)}.</span></label><button type="submit" class="portal-button">Согласовать ${money(q.total)} ${icon}</button><p class="portal-hint">Согласование не списывает деньги с вашей карты.</p></form><details class="portal-editor"><summary>Нужно изменить смету <span aria-hidden="true">+</span></summary><form data-form="reject" data-id="${esc(order.id)}" data-quote="${esc(q.id)}"><label>Что нужно пересмотреть<textarea name="reason" required rows="2" maxlength="2000" placeholder="Уточните, с чем вы не согласны"></textarea></label><button type="submit" class="portal-button is-small">Запросить пересмотр <svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg></button></form></details>` : ''}</section>`;
  }
  function adminTools(order) {
    const existing = order.quote?.items || [{title:'',quantity:1,unitPrice:''}];
    const availableStatuses = [order.status,...(TRANSITIONS[order.status] || [])].filter(key=>key===order.status || (key!=='in_progress'||order.quote?.status==='approved') && (key!=='awaiting_approval'||order.quote?.status==='pending'));
    const customers = state.data.customers || [];
    return `<details class="portal-editor"><summary>Управление заказом <span aria-hidden="true">+</span></summary><form data-form="status" data-id="${esc(order.id)}" data-current-status="${esc(order.status)}"><div class="portal-form-grid"><label>Статус<select name="status">${availableStatuses.map(key=>`<option value="${key}" ${order.status === key ? 'selected' : ''}>${order.status==='in_progress'&&key==='diagnostics'?'Приостановить для диагностики':STATUS[key]}</option>`).join('')}</select></label><label>Дата и время визита<input type="datetime-local" name="scheduledAt" value="${esc(localDate(order.scheduledAt))}"></label></div><label>${order.status==='in_progress'?'Комментарий / причина приостановки':'Комментарий об изменении'}<textarea name="note" maxlength="2000" rows="2" placeholder="Будет виден в истории заказа"></textarea></label><button type="submit" class="portal-button is-small">Сохранить изменения ${icon}</button></form></details>${!order.customerId ? `<details class="portal-editor"><summary>Подключить кабинет клиента <span aria-hidden="true">+</span></summary><p class="portal-hint">Сначала подтвердите личность и право клиента на этот заказ. После привязки он увидит смету и переписку. Привязку нельзя изменить.</p>${customers.length ? `<form data-form="link-customer" data-id="${esc(order.id)}"><label>Клиент<select name="customerId" required><option value="">Выберите подтверждённого клиента</option>${customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.email)}${c.phone ? ` · ${esc(c.phone)}` : ''}</option>`).join('')}</select></label><label class="portal-check"><input type="checkbox" required><span>Личность и принадлежность заказа проверены.</span></label><button type="submit" class="portal-button is-small">Связать с кабинетом <svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg></button></form>` : '<p class="portal-hint">Клиенту нужно создать кабинет. Затем обновите список заказов.</p>'}</details>` : ''}<details class="portal-editor"><summary>${order.quote ? 'Подготовить новую смету' : 'Составить смету'} <span aria-hidden="true">+</span></summary><p class="portal-hint">${['diagnostics','awaiting_approval'].includes(order.status) ? 'В новой версии укажите полный согласуемый объём работ. Предыдущая смета сохранится в истории. Каждая новая версия требует согласования клиента; суммы в рублях.' : 'Для подготовки сметы переведите заказ на этап диагностики.'}</p><form data-form="quote" data-id="${esc(order.id)}"><div class="portal-quote-editor">${existing.map(item => quoteRow(item)).join('')}</div><button type="button" class="portal-text-button" data-add-row>+ Добавить позицию</button><label>Пояснение к смете<textarea name="note" rows="2" maxlength="2000" placeholder="Почему необходимы эти работы"></textarea></label><div class="portal-live-total" aria-live="polite">Итого: <strong data-quote-total>${money(existing.reduce((a,i)=>a+Number(i.quantity)*Number(i.unitPrice),0))}</strong></div><button type="submit" class="portal-button is-small" ${!['diagnostics','awaiting_approval'].includes(order.status) ? 'disabled' : ''}>Отправить на согласование ${icon}</button></form></details>`;
  }
  function quoteRow(item = {title:'',quantity:1,unitPrice:''}) { return `<div class="portal-quote-row"><label>Работа / запчасть<input name="itemTitle" required maxlength="200" value="${esc(item.title)}" placeholder="Название позиции"></label><label>Количество<input name="itemQuantity" type="number" required min="1" step="1" max="100" value="${esc(item.quantity)}"></label><label>Цена, ₽<input name="itemPrice" type="number" required min="0" step="1" max="10000000" value="${esc(item.unitPrice)}"></label><button type="button" data-remove-row aria-label="Удалить позицию">×</button></div>`; }
  function detailView(order) {
    if (!order) return '<div class="portal-empty portal-detail-empty"><span class="portal-empty-sign" aria-hidden="true"><svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg></span><h3>Выберите обращение</h3><p>Смета, ход ремонта и переписка появятся здесь.</p></div>';
    return `<div class="portal-detail"><div class="portal-detail-title"><div><p class="portal-eyebrow">${esc(order.publicId || `Заказ ${order.id}`)}</p><h2>${esc(order.model || 'Mercedes-Benz')}</h2></div><span class="portal-status status-${esc(order.status)}">${esc(orderLabel(order))}</span></div><p class="portal-service-name">${esc(service(order.service))}</p><dl class="portal-order-meta"><div><dt>Создано</dt><dd>${esc(date(order.createdAt))}</dd></div><div><dt>Визит</dt><dd>${esc(date(order.scheduledAt))}</dd></div>${admin ? `<div><dt>Клиент</dt><dd>${esc(order.name)}</dd></div><div><dt>Телефон</dt><dd><a href="tel:${esc(String(order.phone || '').replace(/[^+\d]/g,''))}">${esc(order.phone || 'Не указан')}</a></dd></div>` : ''}</dl>${admin && order.carReminderPreference ? '<p class="portal-hint portal-reminder-preference">Клиент хочет обсудить напоминания об обслуживании</p>' : ''}${order.symptom ? `<div class="portal-concern"><span>Что беспокоит</span><p>${esc(order.symptom)}</p></div>` : ''}${quoteView(order)}${admin ? adminTools(order) : ''}<section class="portal-section"><div class="portal-section-heading"><h3>Диалог по заказу</h3><span class="portal-muted">${(order.messages || []).length}</span></div><div class="portal-messages" aria-label="Сообщения по заказу">${(order.messages || []).length ? order.messages.map(m=>`<article class="portal-message ${m.authorRole === 'admin' ? 'is-service' : 'is-client'}"><div><strong>${m.authorRole === 'admin' ? 'STERNOIR' : 'Клиент'}</strong><time>${esc(date(m.createdAt))}</time></div><p>${esc(m.body)}</p></article>`).join('') : '<p class="portal-muted">Здесь можно уточнить детали ремонта и задать вопрос по смете.</p>'}</div><form data-form="message" data-id="${esc(order.id)}" class="portal-message-form"><label class="portal-sr-only" for="order-message">Сообщение</label><textarea id="order-message" name="body" required maxlength="4000" rows="2" placeholder="Написать ${admin ? 'клиенту' : 'сервису'}…"></textarea><button class="portal-button is-small" type="submit">Отправить ${icon}</button></form></section><details class="portal-history"><summary>История изменений <span>${(order.events || []).length}</span></summary><ol>${(order.events || []).map(e=>`<li><time>${esc(date(e.createdAt))}</time><p>${esc(e.body || e.type)}</p></li>`).join('') || '<li>История появится после первого изменения.</li>'}</ol></details></div>`;
  }
  function garageView() {
    const cars = state.data.cars || [];
    return `<section class="portal-garage"><div class="portal-section-heading"><h2>Мой гараж <span>${cars.length ? String(cars.length).padStart(2,'0') : ''}</span></h2><button class="portal-text-button" type="button" data-toggle-car>${state.addingCar ? 'Закрыть' : '+ Добавить Mercedes'}</button></div>${state.addingCar ? `<form data-form="car" class="portal-inline-form"><div class="portal-form-grid"><label>Модель<input name="model" required maxlength="100" placeholder="E 200 / W213"></label><label>Год выпуска<input name="year" type="number" min="1950" max="${new Date().getFullYear()+1}" placeholder="2019"></label><label>Госномер<input name="registration" maxlength="20" placeholder="А000АА 000"></label><label>VIN, необязательно<input name="vin" minlength="17" maxlength="17" pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" placeholder="17 символов"></label></div><label class="portal-check"><input type="checkbox" name="remindersEnabled"><span>Обсудить напоминания с мастером</span></label><button type="submit" class="portal-button is-small">Добавить автомобиль ${icon}</button></form>` : ''}<div class="portal-cars">${cars.length ? cars.map(car=>`<article class="portal-car"><div class="portal-car-main"><span class="portal-car-emblem" aria-hidden="true">✳</span><div><h3>${esc(car.model)}</h3><p>${[car.year,car.registration].filter(Boolean).map(esc).join(' · ') || 'Mercedes-Benz'}</p>${car.vin ? `<p class="portal-vin">VIN ${esc(car.vin)}</p>` : ''}</div><button type="button" class="portal-text-button" data-book-car="${esc(car.id)}">Записать ${icon}</button></div><div class="portal-car-options"><label class="portal-check"><input type="checkbox" data-car-reminders="${esc(car.id)}" ${car.remindersEnabled ? 'checked' : ''}><span>Обсудить напоминания с мастером</span></label><button type="button" data-toggle-delete="${esc(car.id)}" class="portal-text-button" aria-expanded="false">Удалить</button></div><p class="portal-car-feedback" data-car-feedback="${esc(car.id)}" role="status" hidden></p><form data-form="delete-car" data-id="${esc(car.id)}" hidden><p class="portal-hint">Удалить ${esc(car.model)} из гаража? История обращений сохранится.</p><label class="portal-check"><input type="checkbox" required><span>Подтверждаю удаление автомобиля.</span></label><button type="submit" class="portal-button is-small">Удалить из гаража</button></form></article>`).join('') : '<p class="portal-muted">Добавьте автомобиль — при следующей записи его данные уже будут под рукой.</p>'}</div></section>`;
  }
  function bookingView() {
    if (!state.booking) return '';
    const cars = state.data.cars || [];
    return `<section class="portal-inline-form portal-new-booking"><div class="portal-section-heading"><h2>Запись в сервис</h2><button type="button" data-toggle-booking class="portal-text-button">Закрыть</button></div><p class="portal-muted">Оставьте обращение. Сервис уточнит детали и согласует время визита.</p><form data-form="booking"><div class="portal-form-grid"><label>Ваше имя<input name="name" required minlength="2" maxlength="100" value="${esc(state.user.name)}" autocomplete="name"></label><label>Телефон<input name="phone" type="tel" required maxlength="30" value="${esc(state.user.phone || '')}" autocomplete="tel"></label>${cars.length ? `<label>Автомобиль<select name="carId"><option value="">Другой автомобиль</option>${cars.map(c=>`<option value="${esc(c.id)}" ${String(state.booking) === String(c.id) ? 'selected' : ''}>${esc(c.model)}${c.registration ? ` · ${esc(c.registration)}` : ''}</option>`).join('')}</select></label>` : ''}<label>Модель Mercedes<input name="model" required maxlength="100" value="${esc(cars.find(c=>String(c.id)===String(state.booking))?.model || '')}" placeholder="E 200 / W213"></label><label>Направление<select name="service">${Object.entries(SERVICE).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label></div><label>Что беспокоит<textarea name="symptom" required maxlength="3000" rows="3" placeholder="Опишите симптомы или плановые работы"></textarea></label><label class="portal-check"><input name="consent" type="checkbox" required><span>Согласен на <a href="/privacy" target="_blank" rel="noopener">обработку персональных данных</a> для записи в сервис.</span></label><button class="portal-button is-small" type="submit">Отправить обращение ${icon}</button></form></section>`;
  }
  function ordersView() {
    const all = state.data.orders || [];
    const filtered = all.filter(o => (state.filter === 'all' || state.filter === 'active' && !closed(o) || state.filter === 'closed' && closed(o) || o.status === state.filter) && [o.name,o.phone,o.model,o.publicId,o.service].join(' ').toLowerCase().includes(state.search.toLowerCase().trim()));
    if (!filtered.some(o=>String(o.id)===String(state.selected))) state.selected = filtered[0]?.id || null;
    const selected = filtered.find(o=>String(o.id)===String(state.selected));
    return `<section class="portal-orders-section"><div class="portal-section-heading"><h2>${admin ? 'Обращения' : 'Мои обращения'} <span>${all.length ? String(all.length).padStart(2,'0') : ''}</span></h2><button class="portal-text-button" data-refresh type="button">Обновить ↻</button></div><div class="portal-toolbar"><div class="portal-filter-tabs" aria-label="Фильтр обращений">${[['active','В работе'],['closed','Завершённые'],['all','Все']].map(([key,title])=>`<button type="button" data-filter="${key}" aria-pressed="${state.filter===key}" class="${state.filter===key ? 'is-active' : ''}">${title}</button>`).join('')}</div>${admin ? `<label class="portal-search"><span class="portal-sr-only">Поиск по имени, телефону, автомобилю или номеру заказа</span><input data-search type="search" placeholder="Имя, телефон, модель, № заказа" value="${esc(state.search)}"></label><label class="portal-status-filter"><span class="portal-sr-only">Статус заказа</span><select data-status-filter><option value="${['active','closed','all'].includes(state.filter) ? state.filter : 'all'}">Все статусы</option>${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${state.filter===k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}</div>${!all.length ? `<div class="portal-empty"><span class="portal-empty-sign" aria-hidden="true"><svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg></span><h3>${admin ? 'Новые обращения появятся здесь' : 'Начнём с вашего Mercedes'}</h3><p>${admin ? 'Заявки с сайта автоматически попадут в список. Откройте обращение, назначьте визит и подготовьте смету.' : 'После первой записи здесь будут статус обращения, смета и переписка с сервисом.'}</p>${!admin ? '<button type="button" class="portal-button is-small" data-toggle-booking>Записаться в сервис <svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg></button>' : ''}</div>` : !filtered.length ? '<div class="portal-empty"><h3>Обращений не найдено</h3><p>Измените фильтр или поисковый запрос.</p></div>' : `<div class="portal-orders-layout"><div class="portal-order-list" aria-label="Список обращений">${filtered.map(orderCard).join('')}</div><div class="portal-detail-wrap">${detailView(selected)}</div></div>`}</section>`;
  }
  function dashboard() {
    const all = state.data.orders || [];
    return `<div class="portal-heading"><div><p class="portal-eyebrow">STERNOIR / ${admin ? 'Кабинет администратора' : 'Личный кабинет'}</p><h1>${admin ? 'Сервис под контролем' : 'Ваш Mercedes'}</h1><p>${admin ? 'От первого обращения до выдачи автомобиля.' : 'Ваши автомобили, стоимость работ и ход ремонта.'}</p></div><div class="portal-heading-actions">${!admin ? '<button type="button" class="portal-button" data-toggle-booking>Записаться <svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg></button>' : ''}<button type="button" class="portal-text-button" data-logout>Выйти</button></div></div>${flash()}<div class="portal-update-notice" data-updates role="status" ${state.hasUpdates ? '' : 'hidden'}><span>Есть обновления</span><button type="button" class="portal-text-button" data-refresh>Обновить кабинет ↻</button></div>${admin ? `<div class="portal-metrics">${[['new','Новые обращения',all.filter(o=>o.status==='new').length],['awaiting_approval','Этап согласования',all.filter(o=>o.status==='awaiting_approval').length],['in_progress','Автомобили в работе',all.filter(o=>o.status==='in_progress').length],['ready','Готовы к выдаче',all.filter(o=>o.status==='ready').length]].map(([key,title,count])=>`<button type="button" data-filter="${key}" aria-label="${title}: ${count}"><span>${title}</span><strong>${String(count).padStart(2,'0')}</strong><span aria-hidden="true"><svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg></span></button>`).join('')}</div>` : `${bookingView()}${garageView()}`}${ordersView()}`;
  }
  function draw() {
    if (!mount.isConnected || !portalRoot?.isConnected) return;
    mount.innerHTML = `<section class="portal">${!state.user ? authView() : admin && state.user.role !== 'admin' ? `<div class="portal-empty"><p class="portal-eyebrow">Доступ ограничен</p><h1>Этот кабинет — для команды сервиса</h1><p>Вы вошли как ${esc(state.user.email)}. Управление заказами доступно администратору.</p><a class="portal-button is-small" href="/account">Мой кабинет <svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg></a><button type="button" data-logout class="portal-text-button">Выйти из аккаунта</button>${flash()}</div>` : state.data ? dashboard() : `<div class="portal-empty"><h2>Не удалось загрузить кабинет</h2>${flash()}<button type="button" data-refresh class="portal-button is-small">Повторить ↻</button><button data-logout type="button" class="portal-text-button">Выйти</button></div>`}</section>`;
    portalRoot = mount.firstElementChild;
    if (!state.user && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    bind();
  }
  function bind() {
    mount.querySelectorAll('[data-auth]').forEach(b=>b.addEventListener('click',()=>{state.auth=b.dataset.auth;state.error='';state.notice='';draw();}));
    mount.querySelectorAll('[data-dismiss]').forEach(b=>b.addEventListener('click',()=>{state[b.dataset.dismiss]='';draw();}));
    mount.querySelectorAll('[data-logout]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{await api('/api/auth/logout','POST',{});state.user=null;state.data=null;state.error='';state.notice='';draw();}catch(e){notify(e.message,true);}}));
    mount.querySelectorAll('[data-refresh]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{state.error='';await refreshPreservingDrafts();}catch(e){b.disabled=false;const existing=mount.querySelector('[data-updates]');if(existing){existing.hidden=false;existing.querySelector('span').textContent=e.message;}else notify(e.message,true);}}));
    mount.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;draw();}));
    mount.querySelector('[data-status-filter]')?.addEventListener('change', e=>{state.filter=e.target.value;draw();});
    mount.querySelector('[data-search]')?.addEventListener('input', e=>{state.search=e.target.value;const pos=e.target.selectionStart;draw();const input=mount.querySelector('[data-search]');input?.focus();try{input?.setSelectionRange(pos,pos);}catch{}});
    mount.querySelectorAll('[data-order]').forEach(b=>b.addEventListener('click',()=>{state.selected=b.dataset.order;draw();if(window.innerWidth<800) mount.querySelector('.portal-detail')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}));
    mount.querySelectorAll('[data-toggle-car]').forEach(b=>b.addEventListener('click',()=>{state.addingCar=!state.addingCar;draw();mount.querySelector('[data-form="car"] input')?.focus();}));
    mount.querySelectorAll('[data-toggle-booking]').forEach(b=>b.addEventListener('click',()=>{state.booking=!state.booking;draw();mount.querySelector('[data-form="booking"] input')?.focus();}));
    mount.querySelectorAll('[data-toggle-delete]').forEach(b=>b.addEventListener('click',()=>{const form=Array.from(mount.querySelectorAll('[data-form="delete-car"]')).find(f=>f.dataset.id===b.dataset.toggleDelete);if(form){form.hidden=!form.hidden;b.setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden)form.querySelector('input')?.focus();}}));
    mount.querySelectorAll('[data-car-reminders]').forEach(input=>input.addEventListener('change',async()=>{
      const checked=input.checked;input.disabled=true;
      const feedback=Array.from(mount.querySelectorAll('[data-car-feedback]')).find(el=>el.dataset.carFeedback===input.dataset.carReminders);
      try{await api(`/api/cars/${encodeURIComponent(input.dataset.carReminders)}`,'PATCH',{remindersEnabled:checked});const car=(state.data.cars||[]).find(c=>String(c.id)===input.dataset.carReminders);if(car)car.remindersEnabled=checked;snapshot=JSON.stringify(state.data);if(feedback){feedback.hidden=false;feedback.textContent='Предпочтение сохранено.';}}
      catch(error){input.checked=!checked;if(feedback){feedback.hidden=false;feedback.textContent=error.message;}}
      finally{input.disabled=false;}
    }));
    mount.querySelectorAll('[data-book-car]').forEach(b=>b.addEventListener('click',()=>{state.booking=b.dataset.bookCar;draw();mount.querySelector('.portal-new-booking')?.scrollIntoView({block:'start',behavior:'smooth'});}));
    mount.querySelector('[name="carId"]')?.addEventListener('change',e=>{const car=(state.data.cars||[]).find(c=>String(c.id)===e.target.value);const model=mount.querySelector('[data-form="booking"] [name="model"]');if(car&&model)model.value=car.model;});
    mount.querySelectorAll('[data-add-row]').forEach(b=>b.addEventListener('click',()=>{b.form.dataset.dirty='true';const list=b.form.querySelector('.portal-quote-editor');list.insertAdjacentHTML('beforeend',quoteRow());list.lastElementChild.querySelector('input').focus();}));
    mount.querySelectorAll('.portal-quote-editor').forEach(list=>{
      list.addEventListener('click',e=>{const b=e.target.closest('[data-remove-row]');if(b){list.closest('form').dataset.dirty='true';if(list.children.length>1)b.closest('.portal-quote-row').remove();else b.closest('.portal-quote-row').querySelector('[name="itemTitle"]').value='';updateQuoteTotal(list.closest('form'));}});
      list.addEventListener('input',()=>updateQuoteTotal(list.closest('form')));
    });
    mount.querySelectorAll('form[data-form]').forEach(form=>{
      form.addEventListener('submit',e=>submit(e,form));
      form.addEventListener('input',()=>{form.dataset.dirty='true';});
      form.addEventListener('change',()=>{form.dataset.dirty='true';});
      if(form.dataset.form==='status')form.querySelector('[name="status"]')?.addEventListener('change',e=>{form.querySelector('[name="note"]').required=form.dataset.currentStatus==='in_progress'&&e.target.value==='diagnostics';});
    });
  }
  function updateQuoteTotal(form) { const sum=Array.from(form.querySelectorAll('.portal-quote-row')).reduce((a,row)=>a+Number(row.querySelector('[name="itemQuantity"]').value)*Number(row.querySelector('[name="itemPrice"]').value),0);form.querySelector('[data-quote-total]').textContent=money(sum); }
  async function submit(event, form) {
    event.preventDefault(); if (!form.reportValidity()) return;
    const button=form.querySelector('[type="submit"]'); if(button?.disabled)return;
    const original=button?.innerHTML; if(button){button.disabled=true;button.textContent='Сохраняем…';}
    state.error='';state.notice='';
    const values=Object.fromEntries(new FormData(form));
    try {
      switch(form.dataset.form) {
        case 'auth': {
          const register=!admin&&state.auth==='register';
          await api(`/api/auth/${register?'register':'login'}`,'POST',{...values,...(register?{consent:true}:{})});
          await reload(); break;
        }
        case 'car': {
          await api('/api/cars','POST',{model:values.model,registration:values.registration||undefined,vin:values.vin||undefined,year:values.year||undefined,remindersEnabled:values.remindersEnabled==='on'});
          state.addingCar=false;state.notice='Автомобиль добавлен в гараж.';await reload();break;
        }
        case 'delete-car': {
          await api(`/api/cars/${encodeURIComponent(form.dataset.id)}`,'DELETE');
          form.dataset.dirty='false';state.notice='Автомобиль удалён из гаража. История обращений сохранена.';await refreshPreservingDrafts();break;
        }
        case 'booking': {
          await api('/api/bookings','POST',{...values,carId:values.carId||undefined,email:state.user.email,consent:true});
          state.booking=false;state.filter='active';state.notice='Обращение отправлено. Сервис свяжется с вами для согласования времени.';await reload();break;
        }
        case 'approve': {
          await api(`/api/orders/${encodeURIComponent(form.dataset.id)}/approve`,'POST',{quoteId:form.dataset.quote});
          state.notice='Смета согласована. Решение сохранено в истории заказа.';await reload();break;
        }
        case 'reject': {
          if(!values.reason.trim())throw new Error('Укажите причину пересмотра.');
          await api(`/api/orders/${encodeURIComponent(form.dataset.id)}/reject`,'POST',{quoteId:form.dataset.quote,reason:values.reason.trim()});
          state.notice='Запрос на пересмотр сохранён. Сервис уточнит состав работ.';await reload();break;
        }
        case 'message': {
          if(!values.body.trim())throw new Error('Введите сообщение.');
          await api(`${admin?'/api/admin':'/api'}/orders/${encodeURIComponent(form.dataset.id)}/messages`,'POST',{body:values.body.trim()});
          state.notice='Сообщение отправлено.';await reload();break;
        }
        case 'link-customer': {
          await api(`/api/admin/orders/${encodeURIComponent(form.dataset.id)}`,'PATCH',{customerId:values.customerId});
          state.notice='Заказ добавлен в кабинет выбранного клиента.';await reload();break;
        }
        case 'status': {
          if(form.dataset.currentStatus==='in_progress'&&values.status==='diagnostics'&&!values.note.trim())throw new Error('Укажите причину приостановки ремонта.');
          if(values.status==='scheduled'&&!values.scheduledAt)throw new Error('Укажите дату и время визита.');
          await api(`/api/admin/orders/${encodeURIComponent(form.dataset.id)}`,'PATCH',{status:values.status,scheduledAt:values.scheduledAt?new Date(values.scheduledAt).toISOString():null,...(values.note.trim()?{note:values.note.trim()}:{})});
          state.notice='Заказ обновлён.';await reload();break;
        }
        case 'quote': {
          const items=Array.from(form.querySelectorAll('.portal-quote-row')).map(row=>({title:row.querySelector('[name="itemTitle"]').value.trim(),quantity:Number(row.querySelector('[name="itemQuantity"]').value),unitPrice:Number(row.querySelector('[name="itemPrice"]').value)}));
          if(!items.length||items.some(i=>!i.title||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>100||!Number.isSafeInteger(i.unitPrice)||i.unitPrice<0))throw new Error('Проверьте название, количество и цену каждой позиции.');
          await api(`/api/admin/orders/${encodeURIComponent(form.dataset.id)}/quote`,'POST',{items,note:values.note});
          state.notice='Новая смета отправлена клиенту на согласование.';await reload();break;
        }
      }
      mount.querySelector('.portal-alert')?.focus();
    } catch(error) {
      const alert=mount.querySelector('.portal-form-error'); if(alert)alert.remove();
      const block=document.createElement('p');block.className='portal-alert is-error portal-form-error';block.setAttribute('role','alert');block.setAttribute('tabindex','-1');block.textContent=error.message;form.prepend(block);block.focus();
      if(error.status===401&&form.dataset.form!=='auth'){state.user=null;state.data=null;state.error='Сессия завершилась. Войдите снова.';draw();}
    } finally { if(button?.isConnected){button.disabled=false;button.innerHTML=original;} }
  }
  try { await reload(); } catch(error) { state.error=error.message; draw(); }
}
