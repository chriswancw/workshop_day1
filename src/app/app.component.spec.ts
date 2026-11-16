import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { Link } from './links.service';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let app: AppComponent;
  let http: HttpTestingController;
  let element: HTMLElement;
  const link: Link = {
    code: 'Ab12Cd',
    url: 'https://example.com/long',
    shortUrl: 'http://localhost:3000/Ab12Cd',
    hits: 0,
    createdAt: '2026-11-16T00:00:00.000Z'
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()]
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AppComponent);
    app = fixture.componentInstance;
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  function load(links: Link[] = []): void {
    const request = http.expectOne('/api/links');
    expect(request.request.method).toBe('GET');
    request.flush(links);
    fixture.detectChanges();
  }

  it('announces loading and then the empty state', () => {
    expect(element.textContent).toContain('Loading links...');
    load();
    expect(element.textContent).toContain('No links yet.');
    expect(app.loading()).toBeFalse();
  });

  it('rejects missing, malformed and non-HTTP(S) URLs without submitting', () => {
    load();
    for (const value of ['', 'not a url', 'ftp://example.com', 'javascript:alert(1)', '   ']) {
      app.form.controls.url.setValue(value);
      app.submit();
      expect(app.form.invalid).withContext(value).toBeTrue();
    }
    http.expectNone('/api/links');
    fixture.detectChanges();
    expect(element.querySelector('#url')?.getAttribute('aria-invalid')).toBe('true');
    expect(element.querySelector('#url-error')?.textContent).toContain('Enter a valid');
  });

  it('accepts HTTP and HTTPS and sends a trimmed typed payload', () => {
    load();
    app.form.controls.url.setValue('http://example.com');
    expect(app.form.valid).toBeTrue();
    app.form.controls.url.setValue(`  ${link.url}  `);
    app.submit();
    const request = http.expectOne('/api/links');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ url: link.url });
    request.flush(link, { status: 201, statusText: 'Created' });
    load([link]);
    expect(app.form.controls.url.value).toBe('');
    expect(element.textContent).toContain('Your short link is ready');
    expect(element.querySelector('.success a')?.getAttribute('href')).toBe(link.shortUrl);
    expect(element.querySelector('tbody')?.textContent).toContain(link.url);
  });

  it('blocks duplicate submissions and restores controls after success', () => {
    load();
    app.form.controls.url.setValue(link.url);
    app.submit();
    app.submit();
    fixture.detectChanges();
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBeTrue();
    expect(element.querySelector<HTMLInputElement>('#url')?.readOnly).toBeTrue();
    const requests = http.match('/api/links');
    expect(requests.length).toBe(1);
    requests[0].flush(link, { status: 201, statusText: 'Created' });
    load([link]);
    expect(app.submitting()).toBeFalse();
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBeFalse();
  });

  it('shows server validation errors beside the field and allows correction', () => {
    load();
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne('/api/links').flush({ error: 'Invalid URL from server' }, {
      status: 400, statusText: 'Bad Request'
    });
    fixture.detectChanges();
    expect(element.querySelector('#url-error')?.textContent).toContain('Invalid URL from server');
    expect(app.form.controls.url.value).toBe(link.url);
    expect(app.submitting()).toBeFalse();
    app.form.controls.url.setValue('https://example.org');
    expect(app.submitError()).toBe('');
  });

  it('reports network errors without losing input and permits retry', () => {
    load();
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne('/api/links').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(element.querySelector('#url-error')?.textContent).toContain('Cannot reach the server');
    expect(app.submitting()).toBeFalse();
    app.submit();
    http.expectOne('/api/links').flush(link, { status: 201, statusText: 'Created' });
    load([link]);
  });

  it('refreshes hit counts and retains clearly labelled stale rows on list failure', () => {
    load([link]);
    app.refresh();
    http.expectOne('/api/links').flush([{ ...link, hits: 1 }]);
    fixture.detectChanges();
    expect(element.querySelector('tbody tr td:last-child')?.textContent?.trim()).toBe('1');
    app.refresh();
    http.expectOne('/api/links').flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('request failed');
    expect(element.textContent).toContain('Showing previously loaded links');
    expect(app.links()[0].hits).toBe(1);
    expect(app.loading()).toBeFalse();
  });

  it('reports initial list errors rather than an empty success state and retries', () => {
    http.expectOne('/api/links').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(element.textContent).toContain('Cannot reach the server');
    expect(element.textContent).not.toContain('No links yet.');
    element.querySelector<HTMLButtonElement>('.secondary')?.click();
    load();
    expect(app.listError()).toBe('');
  });

  it('cancels an older list request when creation triggers a fresh list', () => {
    const initialRequest = http.expectOne('/api/links');
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne('/api/links').flush(link, { status: 201, statusText: 'Created' });
    expect(initialRequest.cancelled).toBeTrue();
    load([link]);
    expect(app.links()).toEqual([link]);
  });

  it('cancels active requests when the component is destroyed', () => {
    const request = http.expectOne('/api/links');
    fixture.destroy();
    expect(request.cancelled).toBeTrue();
  });
});
