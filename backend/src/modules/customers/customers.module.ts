import { Module } from '@nestjs/common';
import { CustomersController } from './api/customers.controller';
import { ConsentService } from './application/consent.service';
import { CustomersService } from './application/customers.service';
import { ConsentRepository } from './infrastructure/consent.repository';
import { CustomersRepository } from './infrastructure/customers.repository';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, ConsentService, CustomersRepository, ConsentRepository],
  exports: [CustomersRepository, ConsentRepository, ConsentService],
})
export class CustomersModule {}
