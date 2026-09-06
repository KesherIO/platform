import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DocumentTitleService } from './core/services/document-title.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  constructor() {
    inject(DocumentTitleService).init();
  }
}
